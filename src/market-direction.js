/* NEXUS PRO — market-direction scoring (scoreDirection, Phase 2).

   The pure, testable extraction of the trend score (ts) and strength
   score (sc) that analyzeCoinRpt computes inline in app.js. Building it
   here lets the audit's two scoring fixes be PROVEN by tests:

   - Group B (bull bias in ts): direction-NEUTRAL factors (volume, VPIN
     flow-toxicity, whale-confidence) no longer add an unconditional
     bullish point — they live in the strength score only. Every remaining
     directional factor is symmetric (mirrored thresholds), so a bullish
     scenario and its exact mirror produce mirrored ts (proven by the
     symmetry test). Thresholds are tunable constants up top.

   - Group C (sc shown as "/10" but maxing ~14): sc is normalized to a true
     0..10 against the max achievable under the LIVE weights, so it can
     never print "12/10" again. It stays a STRENGTH score, not a direction.

   Pure: no globals, no I/O. The caller passes every input (and optionally
   the live weights); the same input yields the same scores. UMD-lite so
   the browser (analyzeCoinRpt) and Node/tests share one implementation. */

'use strict';

/* Direction bucket cut points (unchanged from the chart). */
const TS_STRONG_BULL = 4;
const TS_BULL = 2;
const TS_BEAR = -2;
const TS_STRONG_BEAR = -4;

/* sc factor weights — mirror src/monitor-state.js DEFAULT_WEIGHTS so the
   normalization denominator matches what the calibrator tunes. */
const DEFAULT_WEIGHTS = {
  trend: 2,
  whales: 2,
  rsi: 1,
  fr: 1,
  oi: 1,
  vol: 0.5,
  macd: 0.5,
  confluence: 1,
  structure: 1,
  smart: 1,
  flow: 1,
  mood: 0.5,
};

/* Max value each factor can contribute to the raw sc (the addSc caps). */
const MAX_V = {
  trend: 2,
  whales: 2,
  rsi: 1,
  fr: 1,
  oi: 1,
  vol: 0.5,
  macd: 0.5,
  confluence: 1,
  structure: 1,
  smart: 1.5,
  flow: 1.5,
  mood: 1.0,
};

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}

/* De-biasing (audit B) widened the raw ts range: the legacy inline calc
   maxed near ±14, but the symmetric two-sided factors here can reach ±29.
   The chart's direction cut points (±2 / ±4), the strength `trend` factor,
   and the scenario tilt were all tuned for the ±14 scale — so feeding them
   the raw ±29 made "Strong Bull/Bear" trigger on far fewer signals and
   saturated the trend factor. scaleTs maps the raw score back onto the
   legacy ±14 scale (linear, sign-preserving, symmetric) so every existing
   threshold keeps the SAME sensitivity it was designed for. Calibration
   fix, not a behaviour change to the thresholds themselves. */
const RAW_TS_MAX = 29;
const LEGACY_TS_MAX = 14;
function scaleTs(rawTs) {
  const r = n(rawTs);
  const scaled = (r / RAW_TS_MAX) * LEGACY_TS_MAX;
  /* round to nearest integer so bucket edges land cleanly, like the old ts */
  return Math.round(scaled);
}

function classifyDirection(ts) {
  if (ts >= TS_STRONG_BULL) return 'strong_bull';
  if (ts >= TS_BULL) return 'bull';
  if (ts <= TS_STRONG_BEAR) return 'strong_bear';
  if (ts <= TS_BEAR) return 'bear';
  return 'neutral';
}

/* ─── trend score (de-biased, symmetric) ─────────────────────────────
   `i` is a flat input object; every field is read defensively so a
   missing signal contributes 0 (not a fake bullish point). */
function trendScore(i) {
  i = i || {};
  let ts = 0;

  /* Base technicals — already symmetric. */
  ts += i.price > i.ema20 ? 2 : -2;
  ts += i.price > i.ema50 ? 2 : -2;
  ts += i.ema20 > i.ema50 ? 1 : -1;
  ts += n(i.macd && i.macd.h) > 0 ? 2 : -2;
  if (i.macd && i.macd.cross === 'bull') ts += 2;
  else if (i.macd && i.macd.cross === 'bear') ts -= 2;
  if (i.rsi > 55) ts += 1;
  else if (i.rsi < 45) ts -= 1;

  /* Funding / positioning — symmetric. */
  if (i.fr) {
    if (i.fr.rate < 0) ts += 1;
    else if (i.fr.rate > 0.05) ts -= 1;
  }
  if (i.ls) {
    if (i.ls.ratio > 1.5) ts -= 1;
    else if (i.ls.ratio < 0.8) ts += 1;
  }

  /* Top-trader long fraction — mirrored around 0.5 (was: only +). */
  if (i.topTraders && typeof i.topTraders.long === 'number') {
    const L = i.topTraders.long;
    if (L > 0.58) ts += 2;
    else if (L > 0.53) ts += 1;
    else if (L < 0.42) ts -= 2;
    else if (L < 0.47) ts -= 1;
  }
  /* Smart (top traders) vs retail (global) divergence — both directions. */
  if (
    i.topTraders &&
    i.gLS &&
    typeof i.topTraders.long === 'number' &&
    typeof i.gLS.long === 'number'
  ) {
    if (i.topTraders.long > 0.55 && i.gLS.long < 0.45) ts += 2;
    else if (i.topTraders.long < 0.45 && i.gLS.long > 0.55) ts -= 2;
  }
  /* Coinbase premium — mirrored. */
  if (i.cbPrem && typeof i.cbPrem.pct === 'number') {
    const p = i.cbPrem.pct;
    if (p > 0.3) ts += 2;
    else if (p > 0.1) ts += 1;
    else if (p < -0.3) ts -= 2;
    else if (p < -0.1) ts -= 1;
  }
  /* Bitfinex margin long/short — mirrored. */
  if (i.bfxMargin) {
    const lp = n(i.bfxMargin.longPct);
    const sp = n(i.bfxMargin.shortPct);
    if (lp > 70) ts += 2;
    else if (lp > 60) ts += 1;
    if (sp > 70) ts -= 2;
    else if (sp > 60) ts -= 1;
  }
  /* Hyperliquid vs Binance funding both-sided. */
  if (i.hlFunding && i.fr) {
    if (i.hlFunding.rate < 0 && i.fr.rate < 0) ts += 1;
    else if (i.hlFunding.rate > 0 && i.fr.rate > 0.05) ts -= 1;
  }
  /* Funding-rate history skew — mirrored (negative vs positive count). */
  if (i.frHist && i.frHist.totalCount > 0) {
    const neg = n(i.frHist.negCount);
    const pos = n(i.frHist.totalCount) - neg;
    if (neg >= 7) ts += 2;
    else if (neg >= 5) ts += 1;
    if (pos >= 7) ts -= 2;
    else if (pos >= 5) ts -= 1;
  }
  /* OI buildup — now DIRECTIONAL by price (was: flat-price = +2 bull). */
  if (i.oiHist && n(i.oiHist.growth) > 15) {
    const chg = n(i.priceChangePct);
    if (chg > 1) ts += 2;
    else if (chg < -1) ts -= 2;
  }
  /* Taker buy/sell — symmetric. */
  if (i.taker) {
    if (i.taker.ratio > 1.5) ts += 1;
    else if (i.taker.ratio < 0.6) ts -= 1;
  }
  /* Iceberg — symmetric. */
  if (i.iceberg) {
    if (i.iceberg.signal === 'ICEBERG_BUY') ts += 2;
    else if (i.iceberg.signal === 'ICEBERG_SELL') ts -= 2;
  }
  /* Whale PnL — mirrored. */
  if (i.whalePnL && typeof i.whalePnL.pct === 'number') {
    const p = i.whalePnL.pct;
    if (p > 3) ts += 2;
    else if (p > 1) ts += 1;
    else if (p < -3) ts -= 2;
    else if (p < -1) ts -= 1;
  }
  /* News tone — symmetric. */
  if (i.newsScore && typeof i.newsScore.score === 'number') {
    if (i.newsScore.score > 70) ts += 1;
    else if (i.newsScore.score < 30) ts -= 1;
  }

  /* NOTE — removed from ts (direction-neutral; counted only in the
     strength score): volume ratio, VPIN flow toxicity, whale confidence. */
  return ts;
}

/* ─── strength score (normalized to 0..10) ───────────────────────────── */
function strengthScore(i, ts) {
  i = i || {};
  const W = i.weights || DEFAULT_WEIGHTS;
  const scB = [];
  let sc = 0;
  function addSc(name, v, k) {
    const wt = W[k] || 1;
    const adj = v * (wt / (DEFAULT_WEIGHTS[k] || 1));
    scB.push({ n: name, v: Math.round(adj * 100) / 100, k, raw: v });
    sc += adj;
  }

  const wConf = n(i.wConf);
  const volT = n(i.volT);
  addSc('trend', ts >= 4 ? 2 : ts >= 2 ? 1.5 : ts >= 0 ? 1 : 0, 'trend');
  addSc('whales', wConf >= 60 ? 2 : wConf >= 40 ? 1 : 0, 'whales');
  addSc('rsi', i.rsi >= 30 && i.rsi <= 55 ? 1 : 0.5, 'rsi');
  addSc('fr', i.fr && i.fr.rate < 0 ? 1 : i.fr && i.fr.rate > 0.05 ? 0 : 0.5, 'fr');
  addSc('oi', i.oiPresent ? (n(i.ch4h) > 0 && ts > 0 ? 1 : 0.5) : 0, 'oi');
  addSc('vol', volT > 1.3 ? 0.5 : 0, 'vol');
  addSc('macd', n(i.macd && i.macd.h) > 0 ? 0.5 : 0, 'macd');
  addSc('confluence', i.bullTFs >= 3 ? 1 : i.bullTFs >= 2 ? 0.5 : 0, 'confluence');
  addSc('structure', i.struct === 'HH/HL' ? 1 : i.struct === 'LH/LL' ? 0 : 0.5, 'structure');

  let smartSc = 0;
  if (i.topTraders && i.topTraders.long > 0.55) smartSc += 0.6;
  if (i.cbPrem && i.cbPrem.pct > 0.2) smartSc += 0.5;
  if (i.bfxMargin && i.bfxMargin.longPct > 60) smartSc += 0.4;
  addSc('smart', Math.min(1.5, smartSc), 'smart');

  let flowSc = 0;
  if (i.iceberg && i.iceberg.signal === 'ICEBERG_BUY') flowSc += 0.6;
  if (i.vpinData && i.vpinData.vpin > 0.6) flowSc += 0.5;
  if (i.taker && i.taker.ratio > 1.3) flowSc += 0.4;
  addSc('flow', Math.min(1.5, flowSc), 'flow');

  let moodSc = 0;
  if (typeof i.fgValue === 'number' && i.fgValue >= 40 && i.fgValue <= 70) moodSc += 0.5;
  if (i.newsScore && i.newsScore.score > 55) moodSc += 0.5;
  addSc('mood', Math.min(1.0, moodSc), 'mood');

  /* Normalization denominator: max achievable under the LIVE weights. */
  let scMax = 0;
  Object.keys(MAX_V).forEach((k) => {
    scMax += MAX_V[k] * ((W[k] || 1) / (DEFAULT_WEIGHTS[k] || 1));
  });
  const score10 = scMax > 0 ? Math.min(10, round1((sc / scMax) * 10)) : 0;
  return { sc: Math.round(sc * 100) / 100, scMax: Math.round(scMax * 100) / 100, score10, scB };
}

/* Full direction read: de-biased ts (scaled to the legacy ±14 range so the
   cut points stay calibrated) + bucket + normalized strength. `tsRaw` is the
   unscaled symmetric score, exposed for diagnostics. */
function scoreDirection(input) {
  const tsRaw = trendScore(input);
  const ts = scaleTs(tsRaw);
  const strength = strengthScore(input, ts);
  return {
    ts,
    tsRaw,
    dir: classifyDirection(ts),
    sc: strength.sc,
    scMax: strength.scMax,
    score10: strength.score10,
    scB: strength.scB,
  };
}

const MARKET_DIRECTION_API = {
  TS_STRONG_BULL,
  TS_BULL,
  TS_BEAR,
  TS_STRONG_BEAR,
  RAW_TS_MAX,
  LEGACY_TS_MAX,
  DEFAULT_WEIGHTS,
  MAX_V,
  classifyDirection,
  trendScore,
  scaleTs,
  strengthScore,
  scoreDirection,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MARKET_DIRECTION_API;
} else if (typeof window !== 'undefined') {
  window.MarketDirection = MARKET_DIRECTION_API;
}
