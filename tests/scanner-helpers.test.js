const test = require('node:test');
const assert = require('node:assert/strict');

require('./_setup.js');

/* Binance kline tuple shape is [openTime, open, high, low, close, volume, ...].
   The test helpers build synthetic ones at a constant cadence. */
function bar(t, o, h, l, c, v) {
  return [t, o, h, l, c, v];
}
function flatBars(n, price, vol) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(bar(i, price, price, price, price, vol));
  return out;
}

/* ─── isConfirmedBreakout ─────────────────────────────────────────── */

test('isConfirmedBreakout — too-short / missing data is never confirmed', () => {
  assert.deepEqual(isConfirmedBreakout(null), { confirmed: false });
  assert.deepEqual(isConfirmedBreakout([]), { confirmed: false });
  /* 20 prior bars + 1 current bar = 21 required; 10 is nowhere near. */
  assert.deepEqual(isConfirmedBreakout(flatBars(10, 100, 1)), { confirmed: false });
});

test('isConfirmedBreakout — a flat series with no breakout returns false', () => {
  const bars = flatBars(25, 100, 1);
  const r = isConfirmedBreakout(bars, 20, 1.5);
  assert.equal(r.confirmed, false);
  assert.equal(r.priorHigh, 100);
  /* Volume equals the average → ratio = 1.0, well below 1.5x required. */
  assert.ok(Math.abs(r.volRatio - 1) < 1e-9);
});

test('isConfirmedBreakout — close above prior high on high volume confirms', () => {
  const bars = flatBars(20, 100, 1);
  /* Last bar closes at 105 (above prior high of 100) on 2x volume. */
  bars.push(bar(20, 100, 106, 99, 105, 2));
  const r = isConfirmedBreakout(bars, 20, 1.5);
  assert.equal(r.confirmed, true);
  assert.equal(r.priorHigh, 100);
  assert.ok(Math.abs(r.volRatio - 2) < 1e-9);
});

test('isConfirmedBreakout — high close but low volume is not a breakout', () => {
  /* Same 20 flat bars + a close above prior high on the same volume. */
  const bars = flatBars(20, 100, 1);
  bars.push(bar(20, 100, 106, 99, 105, 1));
  const r = isConfirmedBreakout(bars, 20, 1.5);
  assert.equal(r.confirmed, false, 'volRatio=1 should not satisfy a 1.5x gate');
});

test('isConfirmedBreakout — a wick above prior high that closes below is not a breakout', () => {
  const bars = flatBars(20, 100, 1);
  /* High = 110 (above prior 100) but close = 99 (below prior). Classic wick trap. */
  bars.push(bar(20, 100, 110, 95, 99, 5));
  const r = isConfirmedBreakout(bars, 20, 1.5);
  assert.equal(r.confirmed, false);
});

/* ─── tfAlignment ─────────────────────────────────────────────────── */

/* Monotone up → EMA20 > EMA50 (recent values dominate both, and the
   shorter EMA tracks the trend more tightly). */
function risingCloses(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(bar(i, 100 + i, 100 + i, 100 + i, 100 + i, 1));
  return out;
}
function fallingCloses(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(bar(i, 200 - i, 200 - i, 200 - i, 200 - i, 1));
  return out;
}

test('tfAlignment — missing inputs collapse to neutral (score 0)', () => {
  const r = tfAlignment(null, null, null);
  assert.equal(r.aligned15m1h, false);
  assert.equal(r.bearish4h, false);
  assert.equal(r.bull4h, false);
  assert.equal(r.score, 0);
});

test('tfAlignment — bullish LTFs and bullish HTF = +15 (no 4h penalty)', () => {
  const r = tfAlignment(risingCloses(60), risingCloses(60), risingCloses(60));
  assert.equal(r.aligned15m1h, true);
  assert.equal(r.bull4h, true);
  assert.equal(r.bearish4h, false);
  assert.equal(r.score, 15);
});

test('tfAlignment — bullish LTFs but bearish 4h HTF = +15 - 25 = -10 (headwind)', () => {
  const r = tfAlignment(risingCloses(60), risingCloses(60), fallingCloses(60));
  assert.equal(r.aligned15m1h, true);
  assert.equal(r.bearish4h, true);
  assert.equal(r.score, -10);
});

test('tfAlignment — only 15m bullish (1h missing) does not align', () => {
  const r = tfAlignment(risingCloses(60), null, risingCloses(60));
  assert.equal(r.aligned15m1h, false);
  assert.equal(r.score, 0);
});

test('tfAlignment — series shorter than 50 bars is treated as missing', () => {
  const r = tfAlignment(risingCloses(30), risingCloses(30), risingCloses(30));
  assert.equal(r.aligned15m1h, false);
  assert.equal(r.bearish4h, false, '30 bars is too few to call 4h bearish either');
  assert.equal(r.score, 0);
});

/* ─── atrZones ────────────────────────────────────────────────────── */

test('atrZones — missing price or ATR returns null', () => {
  assert.equal(atrZones(0, 1), null);
  assert.equal(atrZones(100, 0), null);
  assert.equal(atrZones(100, -5), null);
  assert.equal(atrZones(null, 5), null);
});

test('atrZones — default 1.5x ATR stop / 3x ATR target yields RR=2', () => {
  const z = atrZones(100, 2);
  assert.equal(z.entry, 100);
  assert.equal(z.stop, 100 - 3, 'stop = 100 - 1.5*2');
  assert.equal(z.target1, 100 + 6, 'target1 = 100 + 3*2');
  assert.equal(z.target2, 100 + 10, 'target2 = 100 + 5*2');
  assert.equal(z.rr, 2);
  assert.equal(z.atr, 2);
});

test('atrZones — tight support lifts the stop (better floor)', () => {
  /* ATR stop would land at 97; support at 98 should pull the stop up
     to 98 * 0.985 = 96.53… Wait — 98 * 0.985 = 96.53 which is LOWER.
     So support only helps when it's tight *above* the ATR stop.
     With support = 99, support*0.985 = 97.515 which IS above the
     ATR stop of 97, so stop becomes 97.515. */
  const z = atrZones(100, 2, 99, null);
  assert.ok(z.stop > 97, `expected stop > ATR floor (97), got ${z.stop}`);
  assert.ok(Math.abs(z.stop - 99 * 0.985) < 1e-9);
});

test('atrZones — resistance caps the target', () => {
  /* ATR target would be 106; resistance at 104 caps it to 104. */
  const z = atrZones(100, 2, null, 104);
  assert.equal(z.target1, 104);
  /* RR degrades because reward shrank but risk didn't. */
  assert.ok(z.rr < 2);
});

test('atrZones — resistance below price is ignored (bogus input)', () => {
  const z = atrZones(100, 2, null, 90);
  assert.equal(z.target1, 106, 'resistance at 90 < price 100, should be ignored');
});

test('atrZones — accumulation multipliers widen targets but keep stop', () => {
  /* Pre-pump candidates expect a full-launch move, not a swing.
     Pass {stop:1.5, t1:5, t2:10} and verify the targets expand
     while the stop stays at the same risk distance. */
  const wide = atrZones(100, 2, null, null, { stop: 1.5, t1: 5, t2: 10 });
  assert.equal(wide.stop, 100 - 3, 'stop unchanged: 100 - 1.5*2');
  assert.equal(wide.target1, 100 + 10, 'target1 widened: 100 + 5*2');
  assert.equal(wide.target2, 100 + 20, 'target2 widened: 100 + 10*2');
  /* Reward / risk = (10 - 0) / 3 ≈ 3.33 */
  assert.ok(Math.abs(wide.rr - 3.33) < 0.01, `expected RR ≈ 3.33, got ${wide.rr}`);
});

test('atrZones — degenerate geometry returns null (AUDIT-atrZones)', () => {
  /* Negative t1 multiplier makes target1 = price - t1*atr — i.e.
     BELOW the entry. The earlier code returned a position object
     with no upside (and rr silently 0), indistinguishable from a
     low-quality but valid setup. Now the helper rejects it. */
  const inverted = atrZones(100, 2, null, null, { t1: -3 });
  assert.equal(inverted, null, 'target1 below price must reject');

  /* Negative stop multiplier puts stop ABOVE entry — also rejected. */
  const stopAbove = atrZones(100, 2, null, null, { stop: -1.5 });
  assert.equal(stopAbove, null, 'stop above price must reject');

  /* Sanity check: a valid setup still returns a result. */
  const valid = atrZones(100, 2, null, 105);
  assert.ok(valid && valid.target1 === 105);
});

test('atrZones — partial mults object falls back to defaults for missing keys', () => {
  /* Caller overrides only t1 — stop and t2 should keep the defaults. */
  const z = atrZones(100, 2, null, null, { t1: 7 });
  assert.equal(z.stop, 100 - 3, 'stop default 1.5x');
  assert.equal(z.target1, 100 + 14, 'target1 from override: 100 + 7*2');
  assert.equal(z.target2, 100 + 10, 'target2 default 5x');
});

/* ─── countWavesInWindow ──────────────────────────────────────────── */

/* ─── evaluateProvenStatus ──────────────────────────────────────── */

test('evaluateProvenStatus — missing coinStat returns false + rate 0', () => {
  assert.deepEqual(evaluateProvenStatus(null), { proven: false, rate: 0 });
  assert.deepEqual(evaluateProvenStatus(undefined), { proven: false, rate: 0 });
});

test('evaluateProvenStatus — missing total or rate field returns false + rate 0', () => {
  assert.deepEqual(evaluateProvenStatus({}), { proven: false, rate: 0 });
  assert.deepEqual(evaluateProvenStatus({ total: 10 }), { proven: false, rate: 0 });
  assert.deepEqual(evaluateProvenStatus({ rate: 70 }), { proven: false, rate: 0 });
});

test('evaluateProvenStatus — too few trades blocks proven (contract: 5 min)', () => {
  /* 4 trades is below the threshold even at 100% win rate. */
  assert.deepEqual(evaluateProvenStatus({ total: 4, rate: 100 }), { proven: false, rate: 100 });
  assert.deepEqual(evaluateProvenStatus({ total: 1, rate: 100 }), { proven: false, rate: 100 });
});

test('evaluateProvenStatus — exactly 5 trades crosses the boundary (contract: >= 5)', () => {
  /* The contract is >=, not >. At total === 5 with rate >= 60, proven. */
  assert.deepEqual(evaluateProvenStatus({ total: 5, rate: 60 }), { proven: true, rate: 60 });
});

test('evaluateProvenStatus — too low win rate blocks proven (contract: 60 min)', () => {
  /* 59% with plenty of samples is still below the threshold. */
  assert.deepEqual(evaluateProvenStatus({ total: 50, rate: 59 }), { proven: false, rate: 59 });
});

test('evaluateProvenStatus — exactly 60% win rate crosses the boundary (contract: >= 60)', () => {
  assert.deepEqual(evaluateProvenStatus({ total: 5, rate: 60 }), { proven: true, rate: 60 });
});

test('evaluateProvenStatus — strong record clears both thresholds', () => {
  assert.deepEqual(evaluateProvenStatus({ total: 20, rate: 75 }), { proven: true, rate: 75 });
});

test('evaluateProvenStatus — custom thresholds override defaults', () => {
  /* If the platform tunes thresholds (10 trades, 70%), the helper
     respects the new values. This is the seam a future calibration
     layer or A/B test would attach to. */
  assert.deepEqual(evaluateProvenStatus({ total: 8, rate: 80 }, 10, 70), {
    proven: false,
    rate: 80,
  });
  assert.deepEqual(evaluateProvenStatus({ total: 12, rate: 80 }, 10, 70), {
    proven: true,
    rate: 80,
  });
});

test('evaluateProvenStatus — defends against rate=0 with total>=5 (zero division avoidance)', () => {
  /* A losing streak shouldn't produce a noisy "proven" via stale data. */
  assert.deepEqual(evaluateProvenStatus({ total: 10, rate: 0 }), { proven: false, rate: 0 });
});

/* ─── pickCardVisualTier ────────────────────────────────────────── */

test('pickCardVisualTier — null signal falls to default tier', () => {
  const v = pickCardVisualTier(null);
  assert.equal(v.tier, 'default');
  assert.equal(v.marker, '');
  assert.equal(v.hasBanner, false);
});

test('pickCardVisualTier — bare signal with no flags = default + up bar', () => {
  const v = pickCardVisualTier({ tags: [], type: 'daily' });
  assert.equal(v.tier, 'default');
  assert.equal(v.barColor, 'var(--up)');
  assert.equal(v.marker, '');
  assert.equal(v.cardStyle, '');
  assert.equal(v.hasBanner, false);
});

test('pickCardVisualTier — fast type changes default bar to blue', () => {
  const v = pickCardVisualTier({ tags: [], type: 'fast' });
  assert.equal(v.barColor, 'var(--blue)');
});

test('pickCardVisualTier — confirmed flag = green tier', () => {
  const v = pickCardVisualTier({ tags: [], confirmed: true });
  assert.equal(v.tier, 'confirmed');
  assert.equal(v.marker, '🟢 ');
});

test('pickCardVisualTier — ultra flag outranks confirmed', () => {
  const v = pickCardVisualTier({ tags: [], ultra: true, confirmed: true });
  assert.equal(v.tier, 'ultra');
  assert.equal(v.marker, '⭐ ');
});

test('pickCardVisualTier — WHALE_TARGET tag elevates to whale tier', () => {
  const v = pickCardVisualTier({ tags: ['🐋✨WHALE_TARGET:75'], ultra: false });
  assert.equal(v.tier, 'whale');
  assert.equal(v.marker, '🐋✨ ');
  assert.ok(v.cardStyle.indexOf('#ffd700') >= 0, 'whale card style should include gold border');
  assert.equal(v.hasBanner, false, 'whale tier alone does NOT show the banner');
});

test('pickCardVisualTier — WHALE_TARGET + proven = double tier (the killer combo)', () => {
  const v = pickCardVisualTier({
    tags: ['🐋✨WHALE_TARGET:75'],
    proven: true,
  });
  assert.equal(v.tier, 'double');
  assert.equal(v.marker, '🌟 ');
  assert.ok(v.cardStyle.indexOf('#b07cff') >= 0, 'double card style should include purple');
  assert.ok(v.cardStyle.indexOf('#ffd700') < 0, 'double does NOT include the gold-border style');
  assert.equal(v.hasBanner, true, 'double tier must render the banner');
});

test('pickCardVisualTier — proven without WHALE_TARGET = NO double (must be both)', () => {
  /* Defensive: a proven coin without whale activity is just confirmed
     or ultra at most — never double. The banner should NOT show. */
  const v = pickCardVisualTier({
    tags: [],
    proven: true,
    ultra: true,
  });
  assert.equal(v.tier, 'ultra');
  assert.equal(v.hasBanner, false);
});

test('pickCardVisualTier — WHALE_TARGET + proven=false = whale tier (not double)', () => {
  /* Explicit false should NOT activate double — strict equality with
     true is the correct check. */
  const v = pickCardVisualTier({
    tags: ['🐋✨WHALE_TARGET:75'],
    proven: false,
  });
  assert.equal(v.tier, 'whale');
});

test('pickCardVisualTier — tier ladder priority: double > whale > ultra > confirmed > default', () => {
  /* All flags set — the highest tier should win and the banner should
     show because double is at the top of the ladder. */
  const v = pickCardVisualTier({
    tags: ['🐋✨WHALE_TARGET:80'],
    proven: true,
    ultra: true,
    confirmed: true,
    type: 'fast',
  });
  assert.equal(v.tier, 'double');
  assert.equal(v.hasBanner, true);
});

/* ─── scoreGemCandidate ─────────────────────────────────────────── */

test('scoreGemCandidate — null ticker = zero score', () => {
  const r = scoreGemCandidate(null, { vx: 5, timing: 'early' }, {});
  assert.equal(r.score, 0);
  assert.deepEqual(r.tags, []);
});

test('scoreGemCandidate — vol multiplier ladder hits each rung', () => {
  const t = { p: 1, c: 1, v: 1e6, h: 1, l: 1 };
  /* Position-in-range guard: h===l means no bottom-of-range bonus,
     so each call below ONLY gets the vx bonus + the c-in-(0,3) +20. */
  assert.equal(scoreGemCandidate(t, { vx: 5, timing: null }, null).score, 45 + 20);
  assert.equal(scoreGemCandidate(t, { vx: 3.5, timing: null }, null).score, 40 + 20);
  assert.equal(scoreGemCandidate(t, { vx: 2.5, timing: null }, null).score, 30 + 20);
  assert.equal(scoreGemCandidate(t, { vx: 1.7, timing: null }, null).score, 15 + 20);
  assert.equal(scoreGemCandidate(t, { vx: 1.0, timing: null }, null).score, 0 + 20);
});

test('scoreGemCandidate — timing buckets', () => {
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  assert.equal(scoreGemCandidate(t, { vx: 1, timing: 'early' }, null).score, 30);
  assert.equal(scoreGemCandidate(t, { vx: 1, timing: 'still' }, null).score, 15);
  assert.equal(scoreGemCandidate(t, { vx: 1, timing: 'late' }, null).score, 0);
});

test('scoreGemCandidate — bottom-of-range adds 10 only when in lower 30%', () => {
  /* Range: 100 to 110 (span 10). Below 103 = lower 30% -> bonus. */
  const inLow = { p: 102, c: 0, v: 1e6, h: 110, l: 100 };
  const middle = { p: 105, c: 0, v: 1e6, h: 110, l: 100 };
  assert.equal(scoreGemCandidate(inLow, null, null).score, 10);
  assert.equal(scoreGemCandidate(middle, null, null).score, 0);
});

test('scoreGemCandidate — V3 boosts compose correctly', () => {
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  const v3 = {
    iceberg: { signal: 'ICEBERG_BUY' }, // +20
    vpin: { vpin: 0.7 }, // +15
    whalePnL: { pct: 2 }, // +10
    cvd: { divergence: 'BULLISH' }, // +15
  };
  /* No klineStats, no c-bonus. Only V3 contributes. */
  assert.equal(scoreGemCandidate(t, null, v3).score, 60);
  assert.deepEqual(
    scoreGemCandidate(t, null, v3).tags.sort(),
    ['🐋PRO', '🧊ICE', '🧪VPIN', '📈CVD'].sort()
  );
});

test('scoreGemCandidate — VPIN rung is exclusive (high or moderate, not both)', () => {
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.65 } }).score, 15);
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.5 } }).score, 8);
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.3 } }).score, 0);
});

test('scoreGemCandidate — c kicker buckets', () => {
  const t1 = { p: 1, c: 1.5, v: 1e6, h: 1, l: 1 }; // (0,3)
  const t2 = { p: 1, c: 5, v: 1e6, h: 1, l: 1 }; // [3,8)
  const t3 = { p: 1, c: 10, v: 1e6, h: 1, l: 1 }; // out
  assert.equal(scoreGemCandidate(t1, null, null).score, 20);
  assert.equal(scoreGemCandidate(t2, null, null).score, 10);
  assert.equal(scoreGemCandidate(t3, null, null).score, 0);
});

test('scoreGemCandidate — ICEBERG_SELL does NOT trigger the buy boost', () => {
  /* Defensive: only ICEBERG_BUY is bullish; SELL must not be rewarded. */
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  assert.equal(scoreGemCandidate(t, null, { iceberg: { signal: 'ICEBERG_SELL' } }).score, 0);
});

/* ─── getRugPullRisk ─────────────────────────────────────────────── */

test('getRugPullRisk — missing ticker returns max risk (100)', () => {
  assert.equal(getRugPullRisk(null), 100);
  assert.equal(getRugPullRisk(undefined), 100);
});

test('getRugPullRisk — clean coin: high vol, narrow spread, futures, calm = 0', () => {
  const d = { v: 5000000, c: 2 };
  const fr = { rate: 0.0001 };
  const book = { spread: 0.05, bidQty: 5000, askQty: 5000 };
  assert.equal(getRugPullRisk(d, fr, book), 0);
});

test('getRugPullRisk — wide spread alone adds 30', () => {
  const d = { v: 5000000, c: 2 };
  const fr = { rate: 0.0001 };
  const book = { spread: 2, bidQty: 5000, askQty: 5000 };
  assert.equal(getRugPullRisk(d, fr, book), 30);
});

test('getRugPullRisk — thin bid book adds 20', () => {
  const d = { v: 5000000, c: 2 };
  const fr = { rate: 0.0001 };
  const book = { spread: 0.1, bidQty: 50, askQty: 5000 };
  assert.equal(getRugPullRisk(d, fr, book), 20);
});

test('getRugPullRisk — low volume adds 25', () => {
  const d = { v: 100000, c: 2 };
  const fr = { rate: 0.0001 };
  const book = { spread: 0.1, bidQty: 5000, askQty: 5000 };
  assert.equal(getRugPullRisk(d, fr, book), 25);
});

test('getRugPullRisk — extreme price move adds 15', () => {
  const d = { v: 5000000, c: 45 };
  const fr = { rate: 0.0001 };
  const book = { spread: 0.1, bidQty: 5000, askQty: 5000 };
  assert.equal(getRugPullRisk(d, fr, book), 15);
});

test('getRugPullRisk — explicit null fr (no futures market) adds 10', () => {
  /* `null` means "we know this coin has no futures market". */
  const d = { v: 5000000, c: 2 };
  const book = { spread: 0.1, bidQty: 5000, askQty: 5000 };
  assert.equal(getRugPullRisk(d, null, book), 10);
});

test('getRugPullRisk — undefined fr (data not loaded) adds 0', () => {
  /* Cold-start contract: callers pass undefined when the FR feed
     hasn't hydrated yet — must not penalize the candidate. */
  const d = { v: 5000000, c: 2 };
  const book = { spread: 0.1, bidQty: 5000, askQty: 5000 };
  assert.equal(getRugPullRisk(d, undefined, book), 0);
  /* Implicit undefined (omitted argument) also resolves to 0. */
  assert.equal(getRugPullRisk(d, /* fr omitted */ undefined, book), 0);
});

test('getRugPullRisk — multiple red flags stack and cap at 100', () => {
  /* Worst-case shitcoin: wide spread, thin book, low vol, big move,
     no futures. Sum: 30 + 20 + 25 + 15 + 10 = 100 (no cap-bend needed). */
  const d = { v: 100000, c: 60 };
  const book = { spread: 5, bidQty: 10, askQty: 10 };
  assert.equal(getRugPullRisk(d, null, book), 100);
});

test('getRugPullRisk — missing book ticker contributes nothing (gap, not risk)', () => {
  const d = { v: 5000000, c: 2 };
  const fr = { rate: 0.0001 };
  /* No book ticker passed — risk should be 0, not 50 */
  assert.equal(getRugPullRisk(d, fr, null), 0);
});

/* ─── scoreGemCandidate boundary tests (off-by-one mutation guards) ── */

test('scoreGemCandidate — vx ladder boundaries fire at exact threshold', () => {
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  /* Each rung's threshold is inclusive (>=). */
  assert.equal(scoreGemCandidate(t, { vx: 4.0, timing: null }, null).score, 45);
  assert.equal(scoreGemCandidate(t, { vx: 3.999, timing: null }, null).score, 40);
  assert.equal(scoreGemCandidate(t, { vx: 3.0, timing: null }, null).score, 40);
  assert.equal(scoreGemCandidate(t, { vx: 2.999, timing: null }, null).score, 30);
  assert.equal(scoreGemCandidate(t, { vx: 2.0, timing: null }, null).score, 30);
  assert.equal(scoreGemCandidate(t, { vx: 1.999, timing: null }, null).score, 15);
  assert.equal(scoreGemCandidate(t, { vx: 1.5, timing: null }, null).score, 15);
  assert.equal(scoreGemCandidate(t, { vx: 1.499, timing: null }, null).score, 0);
});

test('scoreGemCandidate — VPIN boundaries (>0.6 high, >0.4 moderate)', () => {
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.6 } }).score, 8);
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.601 } }).score, 15);
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.4 } }).score, 0);
  assert.equal(scoreGemCandidate(t, null, { vpin: { vpin: 0.401 } }).score, 8);
});

test('scoreGemCandidate — c boundaries: 0 / 3 / 8 each fall in the right bucket', () => {
  /* c > 0 && c < 3 -> +20. c >= 3 && c < 8 -> +10. c >= 8 -> 0. */
  const at0 = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  const at3 = { p: 1, c: 3, v: 1e6, h: 1, l: 1 };
  const at8 = { p: 1, c: 8, v: 1e6, h: 1, l: 1 };
  const just_below_3 = { p: 1, c: 2.999, v: 1e6, h: 1, l: 1 };
  const just_below_8 = { p: 1, c: 7.999, v: 1e6, h: 1, l: 1 };
  assert.equal(scoreGemCandidate(at0, null, null).score, 0);
  assert.equal(scoreGemCandidate(just_below_3, null, null).score, 20);
  assert.equal(scoreGemCandidate(at3, null, null).score, 10);
  assert.equal(scoreGemCandidate(just_below_8, null, null).score, 10);
  assert.equal(scoreGemCandidate(at8, null, null).score, 0);
});

test('scoreGemCandidate — whalePnL > 1% threshold', () => {
  const t = { p: 1, c: 0, v: 1e6, h: 1, l: 1 };
  assert.equal(scoreGemCandidate(t, null, { whalePnL: { pct: 1 } }).score, 0);
  assert.equal(scoreGemCandidate(t, null, { whalePnL: { pct: 1.001 } }).score, 10);
});

test('scoreGemCandidate — bottom-of-range threshold at exactly 30%', () => {
  /* posInRange < 0.3 — strict less-than. At 30% exactly, NO bonus. */
  const at30 = { p: 103, c: 0, v: 1e6, h: 110, l: 100 }; /* (103-100)/(110-100) = 0.3 */
  const just_below = { p: 102.999, c: 0, v: 1e6, h: 110, l: 100 };
  assert.equal(scoreGemCandidate(at30, null, null).score, 0);
  assert.equal(scoreGemCandidate(just_below, null, null).score, 10);
});

/* ─── walkbackSpikeStart ──────────────────────────────────────────── */

test('walkbackSpikeStart — empty / null input returns 0', () => {
  assert.equal(walkbackSpikeStart(null, 1), 0);
  assert.equal(walkbackSpikeStart([], 1), 0);
});

test('walkbackSpikeStart — invalid avgV returns the most recent index', () => {
  const v = [1, 1, 1, 1, 1];
  assert.equal(walkbackSpikeStart(v, 0), 4);
  assert.equal(walkbackSpikeStart(v, -5), 4);
});

test('walkbackSpikeStart — most recent candle calm: returns N-1 (no spike)', () => {
  /* Spike was 4 bars ago, but the latest is calm — caller measures
     gain from the latest close, which is the right behavior. */
  const v = [1, 1, 5, 5, 1];
  assert.equal(walkbackSpikeStart(v, 1), 4);
});

test('walkbackSpikeStart — trailing spike: returns earliest spike index', () => {
  /* avg=1, threshold=1.5. Last 3 bars all spike. Earliest = idx 2. */
  const v = [1, 1, 5, 5, 5];
  assert.equal(walkbackSpikeStart(v, 1), 2);
});

test('walkbackSpikeStart — entire series is one continuous spike', () => {
  const v = [10, 10, 10, 10, 10];
  assert.equal(walkbackSpikeStart(v, 1), 0);
});

test('walkbackSpikeStart — single-bar spike: returns that bar only', () => {
  /* Only the last bar is hot. */
  const v = [1, 1, 1, 1, 5];
  assert.equal(walkbackSpikeStart(v, 1), 4);
});

test('walkbackSpikeStart — alternating spike/calm/spike: stops at first calm walking back', () => {
  /* Trailing spike at idx 4, calm at 3, spike at 1-2. The earlier
     spike is NOT part of the trailing run — we want idx 4. */
  const v = [5, 5, 1, 5];
  assert.equal(walkbackSpikeStart(v, 1), 3);
});

test('walkbackSpikeStart — multiplier override changes threshold', () => {
  /* avg=1, mult=4 -> threshold=4. Bars at 5 spike; bars at 3 do not. */
  const v = [3, 3, 5];
  assert.equal(walkbackSpikeStart(v, 1, 4), 2);
  /* With default mult=1.5 -> threshold=1.5, all three bars spike. */
  assert.equal(walkbackSpikeStart(v, 1), 0);
});

/* ─── classifyGemTiming ───────────────────────────────────────────── */

test('classifyGemTiming — bucket boundaries match scoreGemCandidate semantics', () => {
  /* < EARLY_MAX (3) = early; < STILL_MAX (8) = still; else late. */
  assert.equal(classifyGemTiming(-1), 'early');
  assert.equal(classifyGemTiming(0), 'early');
  assert.equal(classifyGemTiming(2.999), 'early');
  assert.equal(classifyGemTiming(3), 'still');
  assert.equal(classifyGemTiming(5), 'still');
  assert.equal(classifyGemTiming(7.999), 'still');
  assert.equal(classifyGemTiming(8), 'late');
  assert.equal(classifyGemTiming(50), 'late');
});

test('classifyGemTiming — non-finite input collapses to early (most permissive)', () => {
  assert.equal(classifyGemTiming(NaN), 'early');
  assert.equal(classifyGemTiming(undefined), 'early');
  assert.equal(classifyGemTiming(null), 'early');
  assert.equal(classifyGemTiming(Infinity), 'early');
});

/* ─── isValidGemSymbol ────────────────────────────────────────────── */

test('isValidGemSymbol — accepts uppercase alphanumeric tickers', () => {
  assert.equal(isValidGemSymbol('BTC'), true);
  assert.equal(isValidGemSymbol('1INCH'), true);
  assert.equal(isValidGemSymbol('PEPE2'), true);
  assert.equal(isValidGemSymbol('A'), true);
});

test('isValidGemSymbol — rejects empty / non-string / oversize', () => {
  assert.equal(isValidGemSymbol(''), false);
  assert.equal(isValidGemSymbol(null), false);
  assert.equal(isValidGemSymbol(undefined), false);
  assert.equal(isValidGemSymbol(123), false);
  assert.equal(isValidGemSymbol('A'.repeat(16)), false);
});

test('isValidGemSymbol — rejects punctuation / lowercase / injection vectors', () => {
  /* These are the actual attack shapes that motivated the whitelist:
     punctuation breaks out of the inline JS string + HTML attribute,
     URL parameter splitting via & or ? ruins the Binance request. */
  assert.equal(isValidGemSymbol('btc'), false);
  assert.equal(isValidGemSymbol("X');alert(1);//"), false);
  assert.equal(isValidGemSymbol('BTC&limit=1000'), false);
  assert.equal(isValidGemSymbol('BTC USDT'), false);
  assert.equal(isValidGemSymbol('BTC-USD'), false);
  assert.equal(isValidGemSymbol('<script>'), false);
});

/* ─── GEM_CONFIG immutability ─────────────────────────────────────── */

test('GEM_CONFIG — frozen so accidental mutation cannot drift the contract', () => {
  /* Object.freeze: silently no-op in sloppy mode, TypeError in strict
     mode. The runtime mode here is sloppy (no 'use strict' on the
     vm.runInThisContext wrapper), so we verify the OUTCOME — that
     the assignment did not take — rather than the error path. */
  const original = GEM_CONFIG.SCORE_MIN;
  try {
    GEM_CONFIG.SCORE_MIN = 0;
  } catch {
    /* Strict-mode environments will throw; sloppy will silently no-op. */
  }
  assert.equal(GEM_CONFIG.SCORE_MIN, original);
  assert.equal(Object.isFrozen(GEM_CONFIG), true);
});

test('GEM_CONFIG — score gate raised to 35 (timing-alone-passes guard)', () => {
  /* The orchestrator gate at 35 is the contract that prevents
     timing='early' alone (30 pts) from surfacing as a gem.
     If this drops back to 25 a regression has been introduced. */
  assert.equal(GEM_CONFIG.SCORE_MIN, 35);
});

test('GEM_CONFIG — stables list covers the major USD pegs', () => {
  /* Defensive list — additions are fine; removals are the worry. */
  ['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE'].forEach(s => {
    assert.ok(GEM_CONFIG.STABLES.indexOf(s) !== -1, s + ' missing from STABLES');
  });
});

/* ─── evaluateSignalOutcome ───────────────────────────────────────── */

test('evaluateSignalOutcome — missing or zero entry returns neutral', () => {
  assert.equal(evaluateSignalOutcome(0, 100), 'neutral');
  assert.equal(evaluateSignalOutcome(null, 100), 'neutral');
  assert.equal(evaluateSignalOutcome(100, null), 'neutral');
  assert.equal(evaluateSignalOutcome(-5, 100), 'neutral');
});

test('evaluateSignalOutcome — gain >= 5% by default = win', () => {
  assert.equal(evaluateSignalOutcome(100, 105), 'win');
  assert.equal(evaluateSignalOutcome(100, 110), 'win');
  assert.equal(evaluateSignalOutcome(100, 104.99), 'neutral');
});

test('evaluateSignalOutcome — drop <= -3% by default = loss', () => {
  assert.equal(evaluateSignalOutcome(100, 97), 'loss');
  assert.equal(evaluateSignalOutcome(100, 90), 'loss');
  assert.equal(evaluateSignalOutcome(100, 97.01), 'neutral');
});

test('evaluateSignalOutcome — sideways stays neutral', () => {
  assert.equal(evaluateSignalOutcome(100, 100), 'neutral');
  assert.equal(evaluateSignalOutcome(100, 102), 'neutral');
  assert.equal(evaluateSignalOutcome(100, 98), 'neutral');
});

test('evaluateSignalOutcome — custom thresholds override defaults', () => {
  /* Stricter win threshold (10%): a 6% gain is no longer a win. */
  assert.equal(evaluateSignalOutcome(100, 106, 10, 3), 'neutral');
  assert.equal(evaluateSignalOutcome(100, 110, 10, 3), 'win');
  /* Looser loss threshold (5%): a 4% drop is no longer a loss. */
  assert.equal(evaluateSignalOutcome(100, 96, 5, 5), 'neutral');
  assert.equal(evaluateSignalOutcome(100, 95, 5, 5), 'loss');
});

/* ─── classifySetup ──────────────────────────────────────────────── */

test('classifySetup — missing inputs return "unknown"', () => {
  assert.equal(classifySetup(null, {}, 0, null), 'unknown');
  assert.equal(classifySetup({}, null, 0, null), 'unknown');
});

test('classifySetup — ACC tag wins immediately', () => {
  const r = { tags: ['🐋ACC', '📊VOL'], passed: 4, checks: {} };
  const d = { p: 100, h: 100, c: 1, v: 9e7 };
  /* Even though the price/vol match early_breakout, ACC tag dominates. */
  assert.equal(classifySetup(r, d, 0, null), 'accumulation');
});

test('classifySetup — high vol + flat price = accumulation (no tag needed)', () => {
  const r = { tags: [], passed: 2, checks: {} };
  const d = { p: 100, h: 110, c: 0.5, v: 6e7 };
  assert.equal(classifySetup(r, d, 0, null), 'accumulation');
});

test('classifySetup — BOTTOM tag + bullish CVD = reversal', () => {
  const r = { tags: ['📉BOTTOM'], passed: 3, checks: {} };
  const d = { p: 100, h: 110, c: -2, v: 5e6 };
  assert.equal(classifySetup(r, d, 0, 'BULLISH'), 'reversal');
});

test('classifySetup — BOTTOM tag without bullish CVD is NOT a reversal', () => {
  /* Bottom alone could be capitulation. We need confirmation. */
  const r = { tags: ['📉BOTTOM'], passed: 2, checks: {} };
  const d = { p: 100, h: 110, c: -2, v: 5e6 };
  /* Falls through to mixed (no other category matches). */
  assert.equal(classifySetup(r, d, 0, null), 'mixed');
});

test('classifySetup — near high + small move + high vol = early_breakout', () => {
  /* Pre-pump window: price within 5% of daily high, hasn't run yet. */
  const r = { tags: [], passed: 4, checks: {} };
  const d = { p: 99, h: 100, c: 1.5, v: 6e7 };
  assert.equal(classifySetup(r, d, 0, null), 'early_breakout');
});

test('classifySetup — near high but already moved 4% is NOT early_breakout', () => {
  /* This is the AFTER-breakout case the platform refuses to enter. */
  const r = { tags: [], passed: 4, checks: {} };
  const d = { p: 99, h: 100, c: 4, v: 6e7 };
  /* c > 2 means it's no longer "early" — falls to trend or mixed. */
  assert.notEqual(classifySetup(r, d, 0, null), 'early_breakout');
});

test('classifySetup — small dip while BTC up + RSI passed = pullback', () => {
  const r = { tags: [], passed: 3, checks: { rsi: true } };
  const d = { p: 98, h: 110, c: -1.5, v: 5e6 };
  assert.equal(classifySetup(r, d, 0.5, null), 'pullback');
});

test('classifySetup — modest uptrend with 4+ checks = trend', () => {
  const r = { tags: [], passed: 5, checks: {} };
  const d = { p: 102, h: 105, c: 2, v: 5e6 };
  assert.equal(classifySetup(r, d, 0, null), 'trend');
});

test('classifySetup — uptrend without confluence is "mixed"', () => {
  /* 2% up but only 2 checks passed — not strong enough for trend. */
  const r = { tags: [], passed: 2, checks: {} };
  const d = { p: 102, h: 105, c: 2, v: 5e6 };
  assert.equal(classifySetup(r, d, 0, null), 'mixed');
});

/* ─── countWavesInWindow ──────────────────────────────────────────── */

test('countWavesInWindow — empty / missing waves returns 0', () => {
  assert.equal(countWavesInWindow(null, 60000), 0);
  assert.equal(countWavesInWindow([], 60000), 0);
  assert.equal(countWavesInWindow(undefined, 60000), 0);
});

test('countWavesInWindow — only waves inside the window are counted', () => {
  const now = Date.now();
  const waves = [
    { time: now - 45 * 60 * 1000 }, // 45 min ago — outside 30-min window
    { time: now - 20 * 60 * 1000 }, // 20 min ago — inside
    { time: now - 10 * 60 * 1000 }, // 10 min ago — inside
    { time: now - 1 * 60 * 1000 }, // 1 min ago  — inside
  ];
  assert.equal(countWavesInWindow(waves, 30 * 60 * 1000), 3);
});

test('countWavesInWindow — a shorter window narrows the count', () => {
  const now = Date.now();
  const waves = [
    { time: now - 20 * 60 * 1000 },
    { time: now - 10 * 60 * 1000 },
    { time: now - 1 * 60 * 1000 },
  ];
  assert.equal(countWavesInWindow(waves, 5 * 60 * 1000), 1, 'only the 1-min-ago wave fits');
});

test('countWavesInWindow — entries without a time field are skipped safely', () => {
  const now = Date.now();
  const waves = [null, {}, { time: now - 1000 }];
  assert.equal(countWavesInWindow(waves, 60000), 1);
});

/* ─── rollingOBIFromArr ───────────────────────────────────────────── */

test('rollingOBIFromArr — fewer than 5 samples returns null', () => {
  assert.equal(rollingOBIFromArr(null, 60000), null);
  assert.equal(rollingOBIFromArr([], 60000), null);
  const now = Date.now();
  const arr = [];
  for (let i = 0; i < 4; i++) arr.push({ t: now - i * 1000, r: 1.5 });
  assert.equal(rollingOBIFromArr(arr, 60000), null);
});

test('rollingOBIFromArr — averages samples inside the window', () => {
  const now = Date.now();
  const arr = [];
  for (let i = 0; i < 6; i++) arr.push({ t: now - i * 1000, r: 2 });
  const r = rollingOBIFromArr(arr, 60000);
  assert.equal(r.samples, 6);
  assert.equal(r.avg, 2);
});

/* ─── computePerformanceReport ────────────────────────────────────── */

test('computePerformanceReport — empty history returns a zeroed skeleton', () => {
  const r = computePerformanceReport([], []);
  assert.equal(r.totalChecked, 0);
  assert.equal(r.totalClosed, 0);
  assert.equal(r.byTier.ultra, null);
  assert.equal(r.byTier.whale, null);
  assert.equal(r.byTier.breakout, null);
  assert.deepEqual(r.byExitReason, {});
  assert.deepEqual(r.recentTrend, []);
});

test('computePerformanceReport — tier buckets with <3 samples report null', () => {
  const preds = [
    { checked: true, hit: true, score: 65, pnl: 3 },
    { checked: true, hit: false, score: 65, pnl: -2 },
  ];
  const r = computePerformanceReport(preds, []);
  assert.equal(r.byTier.ultra, null, '2 samples < 3 threshold → null');
});

test('computePerformanceReport — 3-sample bucket computes rate + PF', () => {
  const preds = [
    { checked: true, hit: true, score: 65, pnl: 4 },
    { checked: true, hit: false, score: 65, pnl: -2 },
    { checked: true, partial: true, score: 65, pnl: 1 },
  ];
  const r = computePerformanceReport(preds, []);
  const u = r.byTier.ultra;
  assert.ok(u, 'ultra bucket should materialize at 3 samples');
  assert.equal(u.samples, 3);
  assert.equal(u.wins, 1);
  assert.equal(u.partials, 1);
  assert.equal(u.losses, 1);
  /* (1 win + 1 partial * 0.5) / 3 = 50% */
  assert.equal(u.rate, 50);
  /* Gains = 4+1 = 5; losses_abs = 2; PF = 5/2 = 2.5 */
  assert.equal(u.profitFactor, 2.5);
  /* avgPnl = (4 - 2 + 1) / 3 = 1 */
  assert.equal(u.avgPnl, 1);
});

test('computePerformanceReport — score thresholds match tier buckets', () => {
  /* 3 ultra (score >=60), 3 whale (40-59), 3 breakout (<40) */
  const preds = [
    { checked: true, hit: true, score: 75, pnl: 5 },
    { checked: true, hit: true, score: 65, pnl: 5 },
    { checked: true, hit: true, score: 60, pnl: 5 },
    { checked: true, hit: true, score: 50, pnl: 3 },
    { checked: true, hit: true, score: 45, pnl: 3 },
    { checked: true, hit: true, score: 40, pnl: 3 },
    { checked: true, hit: true, score: 30, pnl: 2 },
    { checked: true, hit: true, score: 20, pnl: 2 },
    { checked: true, hit: true, score: 10, pnl: 2 },
  ];
  const r = computePerformanceReport(preds, []);
  assert.equal(r.byTier.ultra.samples, 3);
  assert.equal(r.byTier.whale.samples, 3);
  assert.equal(r.byTier.breakout.samples, 3);
  assert.equal(r.byTier.ultra.rate, 100);
});

test('computePerformanceReport — groups closed trades by exit reason', () => {
  const trades = [
    { status: 'CLOSED', exitReason: '🎯 Full target' },
    { status: 'CLOSED', exitReason: '🎯 Full target' },
    { status: 'CLOSED', exitReason: '🛑 Stop loss' },
    { status: 'OPEN', exitReason: 'n/a' },
    { status: 'CLOSED' }, // no reason
  ];
  const r = computePerformanceReport([], trades);
  assert.equal(r.totalClosed, 4, '4 CLOSED + 1 OPEN in input, only CLOSED counts');
  assert.equal(r.byExitReason['🎯 Full target'], 2);
  assert.equal(r.byExitReason['🛑 Stop loss'], 1);
  assert.equal(r.byExitReason['unknown'], 1);
});

test('computePerformanceReport — recent trend emitted only at 50+ samples', () => {
  const few = Array.from({ length: 40 }, (_, i) => ({
    checked: true,
    hit: i % 2 === 0,
    score: 50,
    pnl: i % 2 === 0 ? 2 : -1,
  }));
  assert.equal(computePerformanceReport(few, []).recentTrend.length, 0);
  const plenty = Array.from({ length: 75 }, (_, i) => ({
    checked: true,
    hit: i % 2 === 0,
    score: 50,
    pnl: i % 2 === 0 ? 2 : -1,
  }));
  const r = computePerformanceReport(plenty, []);
  /* 75 predictions, window=25 → buckets at 25, 50, 75 */
  assert.equal(r.recentTrend.length, 3);
  assert.equal(r.recentTrend[0].bucket, 25);
  assert.equal(r.recentTrend[2].bucket, 75);
});

test('rollingOBIFromArr — stale samples outside the window are dropped', () => {
  const now = Date.now();
  const arr = [
    /* Five stale samples (>10 min old). */
    { t: now - 11 * 60 * 1000, r: 5 },
    { t: now - 12 * 60 * 1000, r: 5 },
    { t: now - 13 * 60 * 1000, r: 5 },
    { t: now - 14 * 60 * 1000, r: 5 },
    { t: now - 15 * 60 * 1000, r: 5 },
    /* Five fresh samples. */
    { t: now - 1000, r: 1 },
    { t: now - 2000, r: 1 },
    { t: now - 3000, r: 1 },
    { t: now - 4000, r: 1 },
    { t: now - 5000, r: 1 },
  ];
  const r = rollingOBIFromArr(arr, 10 * 60 * 1000);
  assert.equal(r.samples, 5, 'only the fresh samples should count');
  assert.equal(r.avg, 1);
});

/* ─── INTEGRATION SUITE 1: blacklist threshold contract ───────────
   processTradeOutcome, runAutoImprove, and signalQualityGate Gate 4
   all share evaluateBlacklistAdd / evaluateBlacklistRemove. The audit
   (PR #25) caught a UX bug where the user-visible blacklist used a
   looser 3-trades/<30% rule while Gate 4 enforced a stricter 5/<25%
   rule — coins shown as blacklisted still passed signal generation.
   These tests pin down the boundaries so the threshold can't drift
   silently on either side. */

test('evaluateBlacklistAdd — null / missing stats never adds', () => {
  assert.equal(evaluateBlacklistAdd(null), false);
  assert.equal(evaluateBlacklistAdd(undefined), false);
  assert.equal(evaluateBlacklistAdd({}), false);
  assert.equal(evaluateBlacklistAdd({ total: 5 }), false, 'rate missing');
  assert.equal(evaluateBlacklistAdd({ rate: 10 }), false, 'total missing');
});

test('evaluateBlacklistAdd — boundary: 5 trades + <25% adds, exactly 25% does not', () => {
  /* The interesting cases live around the two boundaries (5 trades, 25%). */
  assert.equal(evaluateBlacklistAdd({ total: 4, rate: 0 }), false, '4 trades is not enough sample');
  assert.equal(evaluateBlacklistAdd({ total: 5, rate: 24 }), true, '5 trades + 24% adds');
  assert.equal(
    evaluateBlacklistAdd({ total: 5, rate: 25 }),
    false,
    'exactly 25% is the cutoff (strict <)'
  );
  assert.equal(evaluateBlacklistAdd({ total: 5, rate: 0 }), true, '5 trades + 0% adds');
  assert.equal(evaluateBlacklistAdd({ total: 100, rate: 24 }), true, 'high sample + low rate adds');
  assert.equal(
    evaluateBlacklistAdd({ total: 100, rate: 25 }),
    false,
    'high sample at boundary still excluded'
  );
});

test('evaluateBlacklistRemove — needs 5 trades AND >=55% (wide hysteresis vs add)', () => {
  /* Add fires below 25, remove fires at 55+ — leaves a 25–55% gap so
     a marginal recovery can't immediately un-blacklist a coin. */
  assert.equal(evaluateBlacklistRemove(null), false);
  assert.equal(
    evaluateBlacklistRemove({ total: 4, rate: 99 }),
    false,
    '4 trades insufficient even at 99%'
  );
  assert.equal(
    evaluateBlacklistRemove({ total: 5, rate: 54 }),
    false,
    'in hysteresis gap stays blacklisted'
  );
  assert.equal(evaluateBlacklistRemove({ total: 5, rate: 55 }), true, 'exactly 55% removes');
  assert.equal(evaluateBlacklistRemove({ total: 5, rate: 99 }), true);
});

test('blacklist contract — monotonic-total invariant: any coin reachable on blacklist has total>=5', () => {
  /* The runtime invariant the helper depends on:
     - evaluateBlacklistAdd requires total>=5 to put a coin on the list,
     - cs.total only ever increments in processTradeOutcome,
     - the PR #25 migration drops any pre-existing entry with total<5.
     So a coin that's actually on the blacklist has total>=5, which
     means evaluateBlacklistRemove's `total>=5` guard is redundant for
     real call-sites but matches runAutoImprove's explicit guard.
     This test pins down the chain so a future tweak that breaks any
     link surfaces a clear failure here. */
  /* Step 1: only total>=5 coins can be added. */
  for (let total = 0; total < 5; total++) {
    assert.equal(evaluateBlacklistAdd({ total, rate: 0 }), false, `total=${total} can't be added`);
  }
  /* Step 2: at total>=5, add gates only on rate. */
  assert.equal(evaluateBlacklistAdd({ total: 5, rate: 24 }), true);
  assert.equal(evaluateBlacklistAdd({ total: 5, rate: 25 }), false);
  /* Step 3: a coin with total<5 also cannot be removed (defensive
     symmetry — even if some bad data path put it on the list,
     remove won't fire until total reaches 5). */
  for (let total = 0; total < 5; total++) {
    assert.equal(
      evaluateBlacklistRemove({ total, rate: 99 }),
      false,
      `total=${total} can't be removed even at 99%`
    );
  }
});

test('blacklist contract — add and remove never overlap (no flap risk)', () => {
  /* For every (total, rate) pair, at most one of {add, remove} is true. */
  for (let total = 0; total <= 10; total++) {
    for (let rate = 0; rate <= 100; rate++) {
      const stat = { total, rate };
      const add = evaluateBlacklistAdd(stat);
      const rem = evaluateBlacklistRemove(stat);
      assert.equal(add && rem, false, `${total}t/${rate}% should not trigger both add and remove`);
    }
  }
});

/* ─── INTEGRATION SUITE 2: qualityFilter rejection contract ───────
   qualityFilter() in app.js applies seven hard gates to a
   deepAnalyze result. The actual gate logic now lives in
   qualityFilterRejectReason() so the same boundaries are testable.
   Each test pins one gate at its threshold. */

test('qualityFilterRejectReason — null / empty result rejects', () => {
  assert.equal(qualityFilterRejectReason(null), 'no-data');
  assert.equal(qualityFilterRejectReason(undefined), 'no-data');
});

test('qualityFilterRejectReason — late-entry gate (c >= 5)', () => {
  /* Pre-built passing baseline: clear all the other gates so we can
     isolate one boundary at a time. */
  const base = {
    c: 0,
    passed: 5,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    p: 100,
    tfAlign: { bearish4h: false },
  };
  assert.equal(qualityFilterRejectReason({ ...base, c: 4.99 }), null);
  assert.equal(qualityFilterRejectReason({ ...base, c: 5 }), 'late');
  assert.equal(qualityFilterRejectReason({ ...base, c: 8 }), 'late');
});

test('qualityFilterRejectReason — passed-checks gate (passed < 4)', () => {
  const base = {
    c: 0,
    passed: 4,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    p: 100,
    tfAlign: { bearish4h: false },
  };
  assert.equal(qualityFilterRejectReason({ ...base, passed: 4 }), null);
  assert.equal(qualityFilterRejectReason({ ...base, passed: 3 }), 'low-passed');
  assert.equal(qualityFilterRejectReason({ ...base, passed: 0 }), 'low-passed');
});

test('qualityFilterRejectReason — risk/reward gate (smartEntry.rr < 2.0)', () => {
  const base = { c: 0, passed: 5, pdFlags: 0, p: 100, tfAlign: { bearish4h: false } };
  assert.equal(
    qualityFilterRejectReason({ ...base, smartEntry: { rr: 2.0 } }),
    null,
    'rr=2.0 passes'
  );
  assert.equal(qualityFilterRejectReason({ ...base, smartEntry: { rr: 1.99 } }), 'low-rr');
  assert.equal(qualityFilterRejectReason({ ...base, smartEntry: { rr: 1.5 } }), 'low-rr');
});

test('qualityFilterRejectReason — funding-rate gate (FR > 5%)', () => {
  const base = {
    c: 0,
    passed: 5,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    p: 100,
    tfAlign: { bearish4h: false },
  };
  assert.equal(qualityFilterRejectReason(base, { fr: { rate: 0.05 } }), null, 'rate=5% passes');
  assert.equal(qualityFilterRejectReason(base, { fr: { rate: 0.0501 } }), 'high-fr');
  assert.equal(qualityFilterRejectReason(base, { fr: { rate: 0.1 } }), 'high-fr');
});

test('qualityFilterRejectReason — BTC-crash gate (BTC.c < -3)', () => {
  const base = {
    c: 0,
    passed: 5,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    p: 100,
    tfAlign: { bearish4h: false },
  };
  assert.equal(qualityFilterRejectReason(base, { btc: { c: -3 } }), null);
  assert.equal(qualityFilterRejectReason(base, { btc: { c: -3.01 } }), 'btc-crash');
  assert.equal(qualityFilterRejectReason(base, { btc: { c: -10 } }), 'btc-crash');
});

test('qualityFilterRejectReason — HTF-bear gate only fires when c >= 2', () => {
  /* Pre-pump candidates (c < 2) are NOT rejected on a bearish 4h
     because silent accumulation often happens under a flat/weak HTF.
     Already-running candidates (c >= 2) on a bearish 4h ARE rejected. */
  const tfBear = { tfAlign: { bearish4h: true } };
  const base = { passed: 5, smartEntry: { rr: 3 }, pdFlags: 0, p: 100 };
  assert.equal(
    qualityFilterRejectReason({ ...base, c: 1.5, ...tfBear }),
    null,
    'c=1.5 + 4h bear is fine'
  );
  assert.equal(qualityFilterRejectReason({ ...base, c: 2, ...tfBear }), 'htf-bear');
  assert.equal(qualityFilterRejectReason({ ...base, c: 4, ...tfBear }), 'htf-bear');
});

test('qualityFilterRejectReason — pump-and-dump gate (pdFlags >= 3)', () => {
  const base = { c: 0, passed: 5, smartEntry: { rr: 3 }, p: 100, tfAlign: { bearish4h: false } };
  assert.equal(qualityFilterRejectReason({ ...base, pdFlags: 2 }), null);
  assert.equal(qualityFilterRejectReason({ ...base, pdFlags: 3 }), 'pd');
  assert.equal(qualityFilterRejectReason({ ...base, pdFlags: 5 }), 'pd');
});

test('qualityFilterRejectReason — drift-from-detection gate (>8%)', () => {
  /* Stale signal: caught at $100, now $109 = +9% drift, reject. */
  const base = {
    c: 0,
    passed: 5,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    tfAlign: { bearish4h: false },
  };
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 108 }, { priceAtDetection: 100 }),
    null,
    '+8% is the cutoff'
  );
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 108.01 }, { priceAtDetection: 100 }),
    'drift'
  );
  assert.equal(qualityFilterRejectReason({ ...base, p: 110 }, { priceAtDetection: 100 }), 'drift');
});

/* ─── INTEGRATION SUITE 3: end-to-end pipeline survivor invariant ──
   The composition of the gates should leave a known-good signal
   intact and reject any signal that fails any one gate. This is the
   integration-level test the audit asked for: instead of testing
   each gate in isolation, throw a mixed batch through and verify
   only the all-clean signals survive. */

test('qualityFilterRejectReason — known-good signal passes all gates', () => {
  const good = {
    s: 'GOOD',
    p: 100,
    c: 1,
    passed: 5,
    smartEntry: { rr: 2.5 },
    pdFlags: 0,
    tfAlign: { bearish4h: false },
  };
  const ctx = { fr: { rate: 0.01 }, btc: { c: 0.5 }, priceAtDetection: 99 };
  assert.equal(qualityFilterRejectReason(good, ctx), null);
});

test('qualityFilterRejectReason — survivor batch matches expected', () => {
  /* Mixed batch: each row tagged with the gate it's designed to fail
     (or 'pass' for a clean signal). The pipeline should produce
     exactly the 'pass' rows in order. */
  const ctx = { fr: { rate: 0.01 }, btc: { c: 0.5 }, priceAtDetection: 100 };
  const baseGood = {
    s: 'BTC',
    p: 100,
    c: 1,
    passed: 5,
    smartEntry: { rr: 2.5 },
    pdFlags: 0,
    tfAlign: { bearish4h: false },
  };
  const batch = [
    { tag: 'pass', sig: { ...baseGood, s: 'A' } },
    { tag: 'late', sig: { ...baseGood, s: 'B', c: 6 } },
    { tag: 'low-passed', sig: { ...baseGood, s: 'C', passed: 2 } },
    { tag: 'low-rr', sig: { ...baseGood, s: 'D', smartEntry: { rr: 1.5 } } },
    { tag: 'pd', sig: { ...baseGood, s: 'E', pdFlags: 3 } },
    { tag: 'pass', sig: { ...baseGood, s: 'F' } },
    { tag: 'drift', sig: { ...baseGood, s: 'G', p: 120 } },
  ];
  const survivors = batch
    .filter((row) => qualityFilterRejectReason(row.sig, ctx) === null)
    .map((row) => row.sig.s);
  assert.deepEqual(survivors, ['A', 'F'], 'only the two pass rows survive');
});

/* ─── shared scoring sub-formulas (PR #28) ────────────────────────
   The two scoring formulas (loadTrading confidence, renderTop3 V3
   priority) used to inline the same fact extractions in slightly
   different ways. These tests pin down the shared helpers so each
   call-site composes the same facts under its own scoring policy. */

test('coinbasePremiumPct — null/zero/negative inputs return null', () => {
  assert.equal(coinbasePremiumPct(null, 100), null);
  assert.equal(coinbasePremiumPct(100, null), null);
  assert.equal(coinbasePremiumPct(100, 0), null);
  assert.equal(coinbasePremiumPct(100, -5), null);
  assert.equal(coinbasePremiumPct(0, 100), null, 'zero CB price treated as missing');
});

test('coinbasePremiumPct — positive premium returns positive percentage', () => {
  /* 0.5% premium */
  assert.ok(Math.abs(coinbasePremiumPct(100.5, 100) - 0.5) < 1e-9);
  /* No premium */
  assert.equal(coinbasePremiumPct(100, 100), 0);
  /* Coinbase discount = negative percentage */
  assert.ok(Math.abs(coinbasePremiumPct(99, 100) - -1) < 1e-9);
});

test('coinbasePremiumPct — matches the boundary thresholds in both scoring policies', () => {
  /* loadTrading binary cutoff at +0.2%, renderTop3 tiered at +0.15 / +0.3. */
  assert.ok(coinbasePremiumPct(100.2, 100) > 0.15, 'just over the renderTop3 weak tier');
  assert.ok(coinbasePremiumPct(100.2, 100) > 0.2 - 1e-9, 'right at the loadTrading binary cutoff');
  assert.ok(coinbasePremiumPct(100.4, 100) > 0.3, 'comfortably over the renderTop3 strong tier');
});

test('topTraderLatestLong — missing entry / arrays return null', () => {
  assert.equal(topTraderLatestLong(null), null);
  assert.equal(topTraderLatestLong({}), null, 'no .accounts and no .positions');
  assert.equal(topTraderLatestLong({ accounts: [] }), null, 'empty array');
  assert.equal(topTraderLatestLong({ positions: [] }, 'positions'), null);
  assert.equal(topTraderLatestLong({ accounts: [{}] }), null, 'latest entry missing .long');
  assert.equal(
    topTraderLatestLong({ accounts: [{ long: 'high' }] }),
    null,
    '.long must be numeric'
  );
});

test('topTraderLatestLong — picks the FRESHEST entry (last in array)', () => {
  const data = {
    accounts: [{ long: 0.5 }, { long: 0.7 }, { long: 0.9 }],
  };
  assert.equal(topTraderLatestLong(data), 0.9);
});

test('topTraderLatestLong — defaults to .accounts but reads .positions when asked', () => {
  /* renderTop3 reads .accounts (count-weighted), loadTrading reads
     .positions (size-weighted). Same helper, different slice. */
  const data = {
    accounts: [{ long: 0.6 }],
    positions: [{ long: 0.7 }],
  };
  assert.equal(topTraderLatestLong(data), 0.6, 'default = accounts');
  assert.equal(topTraderLatestLong(data, 'accounts'), 0.6);
  assert.equal(topTraderLatestLong(data, 'positions'), 0.7);
});

test('topTraderLatestLong — boundary at the 0.55 / 0.58 thresholds both formulas use', () => {
  /* Both formulas check long > threshold (strict). Pin both
     boundaries: 0.55 (loadTrading single tier; renderTop3 weak tier)
     and 0.58 (renderTop3 strong tier). */
  assert.equal(topTraderLatestLong({ accounts: [{ long: 0.55 }] }), 0.55);
  assert.equal(topTraderLatestLong({ accounts: [{ long: 0.58 }] }), 0.58);
  /* Both formulas use strict > so 0.55 itself does NOT trigger the
     loadTrading tier — that's a runtime concern, not a helper one,
     but worth documenting here so tests catch any boundary drift. */
});
