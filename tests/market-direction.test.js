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

test('scaleTs — maps the raw ±29 range onto the legacy ±14, sign-preserving + symmetric', () => {
  assert.equal(md.scaleTs(29), 14); // raw max → legacy max
  assert.equal(md.scaleTs(-29), -14);
  assert.equal(md.scaleTs(0), 0);
  assert.equal(md.scaleTs(4), 2); // a mid raw still lands in "Bullish", not "Strong"
  assert.equal(md.scaleTs(8), 4); // ~strong-bull edge
  assert.equal(md.scaleTs(10), -1 * md.scaleTs(-10)); // symmetric
});

test('scoreDirection — ts is scaled (legacy range), tsRaw is the wide score', () => {
  const r = md.scoreDirection(BULL);
  assert.equal(r.tsRaw, 31); // unscaled symmetric raw
  assert.equal(r.ts, md.scaleTs(31)); // scaled onto the legacy range
  assert.ok(r.ts <= 15 && r.ts >= -15, 'scaled ts stays in the legacy band');
  assert.equal(r.dir, 'strong_bull');
  assert.ok(r.score10 <= 10);
  assert.equal(r.dir, md.classifyDirection(r.ts));
  assert.ok(Array.isArray(r.scB));
});

test('scoreDirection — bullish and its mirror give mirrored scaled ts (bias-free, calibrated)', () => {
  const b = md.scoreDirection(BULL);
  const s = md.scoreDirection(BEAR);
  assert.equal(b.ts, -s.ts); // symmetry survives scaling
  assert.equal(b.tsRaw, -s.tsRaw);
});

/* ── pro-conclusion helpers (scenario map + candle-event WHY) ───────────── */

test('priceTargets — splits levels into upside/downside ladders, nearest first', () => {
  const r = md.priceTargets(100, [
    { price: 108, label: 'R' },
    { price: 95, label: 'S' },
    { price: 120, label: 'f100U' },
    { price: 88, label: 'f100D' },
    { price: 103, label: 'f618U' },
  ]);
  assert.deepEqual(
    r.up.map((x) => x.price),
    [103, 108, 120]
  ); // ascending → nearest upside first
  assert.deepEqual(
    r.down.map((x) => x.price),
    [95, 88]
  ); // descending → nearest downside first
  assert.equal(r.up[0].label, 'f618U'); // labels carried through
  assert.equal(r.down[0].label, 'S');
});

test('priceTargets — skips non-finite, equal-to-price, and falsy levels', () => {
  const r = md.priceTargets(100, [
    { price: 100, label: 'at-price' }, // equal → skipped (neither side)
    { price: NaN, label: 'bad' }, // non-finite → skipped
    null, // falsy → skipped
    { price: 110, label: 'R' },
  ]);
  assert.equal(r.up.length, 1);
  assert.equal(r.down.length, 0);
  assert.equal(r.up[0].price, 110);
});

test('priceTargets — non-array levels / bad price yield empty ladders', () => {
  assert.deepEqual(md.priceTargets(100, null), { up: [], down: [] });
  assert.deepEqual(md.priceTargets(NaN, [{ price: 110 }]), { up: [], down: [] });
});

test('candleLevelEvent — close above resistance is a bullish breakout', () => {
  assert.deepEqual(md.candleLevelEvent(110, 90, 105), { event: 'break_up', level: 105 });
});

test('candleLevelEvent — close below support is a bearish breakdown', () => {
  assert.deepEqual(md.candleLevelEvent(80, 90, 105), { event: 'break_down', level: 90 });
});

test('candleLevelEvent — close inside the range is in_range', () => {
  assert.deepEqual(md.candleLevelEvent(97, 90, 105), { event: 'in_range', level: null });
});

test('candleLevelEvent — non-finite close never fabricates a break', () => {
  assert.deepEqual(md.candleLevelEvent(NaN, 90, 105), { event: 'in_range', level: null });
});

/* ── regimeAwareThesis (live-regime framing of the conclusion) ──────────── */

test('regimeAwareThesis — aligned trend boosts conviction, no alt promotion', () => {
  const r = md.regimeAwareThesis({
    thesisDir: 'bear',
    conviction: 7,
    regime: 'trending',
    direction: 'bear',
    volatility: 'normal',
  });
  assert.equal(r.state, 'aligned');
  assert.equal(r.conviction, 8); // +1
  assert.equal(r.delta, 1);
  assert.equal(r.basePromote, false);
  assert.equal(r.riskOff, false);
});

test('regimeAwareThesis — counter-trend conflict trims conviction and promotes the alternate', () => {
  const r = md.regimeAwareThesis({
    thesisDir: 'bull',
    conviction: 7,
    regime: 'trending',
    direction: 'bear', // BTC trend opposes a bull thesis
    volatility: 'normal',
  });
  assert.equal(r.state, 'conflict');
  assert.equal(r.conviction, 5); // -2
  assert.equal(r.basePromote, true);
});

test('regimeAwareThesis — ranging tape fades a directional thesis and promotes the alternate', () => {
  const r = md.regimeAwareThesis({
    thesisDir: 'bear',
    conviction: 7,
    regime: 'ranging',
    direction: 'none',
    volatility: 'normal',
  });
  assert.equal(r.state, 'range_fade');
  assert.equal(r.conviction, 5); // -2
  assert.equal(r.basePromote, true);
});

test('regimeAwareThesis — neutral thesis in a range is coherent (no change)', () => {
  const r = md.regimeAwareThesis({
    thesisDir: 'neutral',
    conviction: 4,
    regime: 'ranging',
    direction: 'none',
    volatility: 'normal',
  });
  assert.equal(r.state, 'range_neutral');
  assert.equal(r.conviction, 4); // unchanged
  assert.equal(r.basePromote, false);
});

test('regimeAwareThesis — high volatility stacks a risk-off trim and clamps at 0', () => {
  const r = md.regimeAwareThesis({
    thesisDir: 'bull',
    conviction: 2,
    regime: 'trending',
    direction: 'bear', // conflict (-2)
    volatility: 'high', // risk-off (-1)
  });
  assert.equal(r.state, 'conflict');
  assert.equal(r.riskOff, true);
  assert.equal(r.conviction, 0); // 2 - 2 - 1 = -1 → clamped to 0
});

test('regimeAwareThesis — aligned conviction never exceeds 10', () => {
  const r = md.regimeAwareThesis({
    thesisDir: 'bull',
    conviction: 10,
    regime: 'trending',
    direction: 'bull',
    volatility: 'normal',
  });
  assert.equal(r.conviction, 10); // +1 then clamped
});

test('regimeAwareThesis — missing/!shaped regime is a safe no-op (unknown)', () => {
  const r = md.regimeAwareThesis({ thesisDir: 'bear', conviction: 6 });
  assert.equal(r.state, 'unknown');
  assert.equal(r.conviction, 6); // untouched → caller renders exactly as before
  assert.equal(r.basePromote, false);
  const bad = md.regimeAwareThesis({ thesisDir: 'bear', conviction: NaN, regime: 'weird' });
  assert.equal(bad.state, 'unknown');
  assert.equal(bad.conviction, 0); // non-finite conviction → 0
});

/* ── swingLevels (tested support/resistance from pivots) ───────────────── */

function _bar(h, l) {
  return [0, 0, h, l, 0, 0];
}

test('swingLevels — finds pivot high/low and splits by current price', () => {
  /* a clean swing high near 112 and swing low near 88, price now 100 */
  const rows = [
    _bar(102, 98),
    _bar(108, 100),
    _bar(112, 104), // pivot high
    _bar(108, 100),
    _bar(101, 95),
    _bar(95, 90),
    _bar(98, 86), // pivot low
    _bar(96, 90),
    _bar(103, 95),
    _bar(110, 103),
    _bar(116, 108), // pivot high
    _bar(109, 101),
    _bar(100, 94),
  ];
  const r = md.swingLevels(rows, { price: 100, left: 2, right: 2, tol: 0.01 });
  assert.ok(r.resistance.length >= 1, 'should find resistance above price');
  assert.ok(r.support.length >= 1, 'should find support below price');
  assert.ok(r.resistance[0].price > 100, 'resistance is above price');
  assert.ok(r.support[0].price < 100, 'support is below price');
});

test('swingLevels — clusters nearby pivots and counts touches', () => {
  /* two highs at ~112 and ~113 (within tol) collapse into one level, touches=2 */
  const rows = [
    _bar(100, 95),
    _bar(106, 100),
    _bar(112, 104), // pivot high #1
    _bar(106, 100),
    _bar(101, 96),
    _bar(107, 100),
    _bar(113, 105), // pivot high #2 (near #1)
    _bar(107, 100),
    _bar(100, 94),
  ];
  const r = md.swingLevels(rows, { price: 90, left: 2, right: 2, tol: 0.02 });
  const top = r.resistance.find((c) => c.touches >= 2);
  assert.ok(top, 'the two close highs cluster into one level with touches>=2');
  assert.ok(top.price > 110 && top.price < 114, 'clustered price is the average');
});

test('swingLevels — empty / non-array / no price degrade safely', () => {
  assert.deepEqual(md.swingLevels([], { price: 100 }), { support: [], resistance: [] });
  assert.deepEqual(md.swingLevels(null, { price: 100 }), { support: [], resistance: [] });
  /* no finite price → can't split → both empty */
  const r = md.swingLevels([_bar(110, 90), _bar(120, 100), _bar(108, 95)], {});
  assert.deepEqual(r, { support: [], resistance: [] });
});

test('swingLevels — nearest level comes first on each side', () => {
  const rows = [
    _bar(100, 95),
    _bar(130, 100),
    _bar(150, 120), // far high
    _bar(130, 100),
    _bar(101, 96),
    _bar(118, 100),
    _bar(125, 108), // near high
    _bar(118, 100),
    _bar(100, 94),
  ];
  const r = md.swingLevels(rows, { price: 110, left: 2, right: 2, tol: 0.005 });
  if (r.resistance.length >= 2) {
    assert.ok(
      r.resistance[0].price < r.resistance[1].price,
      'nearest resistance (lower) is listed first'
    );
  }
});
