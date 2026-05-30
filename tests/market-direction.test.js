/* Unit tests for src/market-direction.js — the de-biased trend score and
   normalized strength score. The headline tests are SYMMETRY (a bullish
   scenario and its exact mirror produce mirrored ts → no structural bull
   bias, audit Group B) and NORMALIZATION (score10 never exceeds 10, audit
   Group C). */

const test = require('node:test');
const assert = require('node:assert/strict');

const md = require('../src/market-direction');

/* Every directional factor at its strongest BULL branch → ts = +31. */
const BULL = {
  price: 110,
  ema20: 100,
  ema50: 90,
  macd: { h: 1, cross: 'bull' },
  rsi: 60,
  fr: { rate: -0.01 },
  ls: { ratio: 0.5 },
  topTraders: { long: 0.6 },
  gLS: { long: 0.4 },
  cbPrem: { pct: 0.4 },
  bfxMargin: { longPct: 75, shortPct: 0 },
  hlFunding: { rate: -0.01 },
  frHist: { negCount: 8, totalCount: 10 },
  oiHist: { growth: 20 },
  priceChangePct: 2,
  taker: { ratio: 2 },
  iceberg: { signal: 'ICEBERG_BUY' },
  whalePnL: { pct: 5 },
  newsScore: { score: 80 },
};
/* The exact mirror — every factor at its strongest BEAR branch → ts = -31. */
const BEAR = {
  price: 90,
  ema20: 100,
  ema50: 110,
  macd: { h: -1, cross: 'bear' },
  rsi: 40,
  fr: { rate: 0.06 },
  ls: { ratio: 2 },
  topTraders: { long: 0.4 },
  gLS: { long: 0.6 },
  cbPrem: { pct: -0.4 },
  bfxMargin: { longPct: 0, shortPct: 75 },
  hlFunding: { rate: 0.01 },
  frHist: { negCount: 2, totalCount: 10 },
  oiHist: { growth: 20 },
  priceChangePct: -2,
  taker: { ratio: 0.5 },
  iceberg: { signal: 'ICEBERG_SELL' },
  whalePnL: { pct: -5 },
  newsScore: { score: 20 },
};

test('classifyDirection — bucket cut points', () => {
  assert.equal(md.classifyDirection(4), 'strong_bull');
  assert.equal(md.classifyDirection(2), 'bull');
  assert.equal(md.classifyDirection(1), 'neutral');
  assert.equal(md.classifyDirection(-1), 'neutral');
  assert.equal(md.classifyDirection(-2), 'bear');
  assert.equal(md.classifyDirection(-4), 'strong_bear');
});

test('trendScore — bullish and its mirror produce mirrored ts (no bias, B)', () => {
  const tsBull = md.trendScore(BULL);
  const tsBear = md.trendScore(BEAR);
  assert.equal(tsBull, 31);
  assert.equal(tsBear, -31);
  assert.equal(tsBull, -tsBear); // perfect symmetry → no structural bull bias
});

test('trendScore — direction-neutral factors do NOT move ts (B fix)', () => {
  const base = md.trendScore(BULL);
  const withNeutral = md.trendScore(
    Object.assign({}, BULL, { volT: 5, vpinData: { vpin: 0.95 }, wConf: 95 })
  );
  assert.equal(withNeutral, base); // volume / VPIN / whale-confidence add 0 to ts
});

test('trendScore — OI buildup is directional, not bullish-by-default', () => {
  /* Isolate the OI factor by differencing against the flat-price case
     (where OI contributes 0) — the symmetric base cancels out. */
  const flat = md.trendScore({ oiHist: { growth: 20 }, priceChangePct: 0 });
  const up = md.trendScore({ oiHist: { growth: 20 }, priceChangePct: 2 });
  const down = md.trendScore({ oiHist: { growth: 20 }, priceChangePct: -2 });
  assert.equal(up - flat, 2); // OI buildup + rising price → +2
  assert.equal(down - flat, -2); // OI buildup + falling price → -2 (was a free +2 before)
});

test('trendScore — absent / neutral optional signals add nothing', () => {
  const base = md.trendScore({
    price: 110,
    ema20: 100,
    ema50: 90,
    macd: { h: 1, cross: 'bull' },
    rsi: 60,
  });
  /* The same base plus every optional signal at its neutral value must
     not change ts (no fake points from a present-but-neutral source). */
  const withNeutral = md.trendScore({
    price: 110,
    ema20: 100,
    ema50: 90,
    macd: { h: 1, cross: 'bull' },
    rsi: 60,
    topTraders: { long: 0.5 },
    cbPrem: { pct: 0 },
    taker: { ratio: 1 },
    whalePnL: { pct: 0 },
    newsScore: { score: 50 },
    frHist: { negCount: 3, totalCount: 6 },
  });
  assert.equal(base, 10);
  assert.equal(withNeutral, base);
});

test('strengthScore — normalized to 0..10, never exceeds the denominator (C)', () => {
  const maxIn = {
    rsi: 45,
    fr: { rate: -0.01 },
    oiPresent: true,
    ch4h: 1,
    volT: 2,
    macd: { h: 1 },
    bullTFs: 3,
    struct: 'HH/HL',
    wConf: 70,
    topTraders: { long: 0.6 },
    cbPrem: { pct: 0.3 },
    bfxMargin: { longPct: 70 },
    iceberg: { signal: 'ICEBERG_BUY' },
    vpinData: { vpin: 0.7 },
    taker: { ratio: 1.5 },
    fgValue: 50,
    newsScore: { score: 60 },
  };
  const r = md.strengthScore(maxIn, 4); // ts>=4 → trend factor maxed
  assert.equal(r.sc, 14); // raw max under default weights
  assert.equal(r.scMax, 14);
  assert.equal(r.score10, 10); // exactly 10, never "12/10"
  assert.ok(r.score10 <= 10);
  assert.equal(r.scB.length, 12);
});

test('strengthScore — custom (doubled) weights keep score10 ≤ 10', () => {
  const W = {};
  Object.keys(md.DEFAULT_WEIGHTS).forEach((k) => (W[k] = md.DEFAULT_WEIGHTS[k] * 2));
  const r = md.strengthScore({ weights: W, rsi: 45, fr: { rate: -0.01 } }, 4);
  assert.ok(r.score10 <= 10);
  assert.equal(r.scMax, 28); // denominator scales with the live weights
});

test('scoreDirection — returns ts, bucket, and normalized strength together', () => {
  const r = md.scoreDirection(BULL);
  assert.equal(r.ts, 31);
  assert.equal(r.dir, 'strong_bull');
  assert.ok(r.score10 <= 10);
  assert.equal(r.dir, md.classifyDirection(r.ts));
  assert.ok(Array.isArray(r.scB));
});
