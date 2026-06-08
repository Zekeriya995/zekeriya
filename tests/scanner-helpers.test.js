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

/* ─── 2026-05-22 audit — Gem Hunter trend gate ─────────────────
   Coins down >5% in 24h must not surface in the gem grid. The
   audit case: HYPER at -6.8% and MEGA at -6.2% were appearing
   as "Early — Enter!" with the previous formula that only
   awarded points for positive ticker.c, didn't reject anything.
   New behaviour: `scoreGemCandidate` short-circuits with
   `blocked: true, tags: ['🔻FALLING']` so the orchestrator can
   skip the candidate cleanly. Pins the boundary (-5% exact)
   and the contract that blocked candidates always get score 0
   and the FALLING tag. */

test('scoreGemCandidate — falling-trend gate blocks coins with c < -5%', () => {
  const tHyper = { p: 0.1, c: -6.8, v: 1e6, h: 0.12, l: 0.09 };
  const out = scoreGemCandidate(tHyper, { vx: 1.6, timing: 'early' }, null);
  assert.equal(out.blocked, true, 'HYPER-shaped (-6.8%) must be blocked');
  assert.equal(out.score, 0);
  assert.deepEqual(out.tags, ['🔻FALLING']);
});

test('scoreGemCandidate — falling-trend gate boundary (-5% exact PASSES)', () => {
  /* Strict `< -5`: -5% exact does NOT block (lets bounce candidates
     at the boundary survive for downstream evaluation). */
  const t = { p: 1, c: -5, v: 1e6, h: 1.1, l: 0.95 };
  const out = scoreGemCandidate(t, { vx: 2, timing: 'early' }, null);
  assert.notEqual(out.blocked, true, '-5% exact should not block (strict <)');
  assert.equal(out.tags.indexOf('🔻FALLING'), -1);
});

test('scoreGemCandidate — falling-trend gate at -5.01% DOES block', () => {
  const t = { p: 1, c: -5.01, v: 1e6, h: 1.1, l: 0.95 };
  const out = scoreGemCandidate(t, { vx: 2, timing: 'early' }, null);
  assert.equal(out.blocked, true, '-5.01% is just over the boundary, must block');
});

test('scoreGemCandidate — positive c values unaffected by trend gate', () => {
  /* Regression guard — the gate must only fire on the negative
     extreme, not on any positive change. */
  const t = { p: 1, c: 2, v: 1e6, h: 1.1, l: 0.95 };
  const out = scoreGemCandidate(t, { vx: 2, timing: 'early' }, null);
  assert.notEqual(out.blocked, true);
  assert.ok(out.score > 0, 'positive c with vx and timing should score');
});

test('scoreGemCandidate — c null (missing data) does NOT block', () => {
  /* Defensive: missing ticker.c is not the same as known-negative.
     A coin where we have no 24h change reading should fall through
     to the rest of the scoring formula, not get auto-blocked. */
  const t = { p: 1, c: null, v: 1e6, h: 1.1, l: 0.95 };
  const out = scoreGemCandidate(t, { vx: 2, timing: 'early' }, null);
  assert.notEqual(out.blocked, true);
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

test('walkbackSpikeStart — original-bug repro: trailing-calm hides earlier spike', () => {
  /* Direct repro of the docstring bug: the most recent candle is calm,
     but a real spike happened earlier. The corrected helper returns
     N-1 (the calm tail) so callers measure gain from the latest close
     rather than from a spike that has already cooled. The OLD in-place
     loop would have set sI back at the spike index — masking the
     real "we missed it" state. */
  assert.equal(walkbackSpikeStart([5, 5, 1], 1), 2);
  /* Real-world variant: spike, calm, calm, calm — same outcome. */
  assert.equal(walkbackSpikeStart([5, 1, 1, 1], 1), 3);
});

test('walkbackSpikeStart — vol exactly equals threshold is NOT a spike (strict >)', () => {
  /* Off-by-one mutation guard: the loop uses strict `> threshold`.
     A bar at exactly avgV*mult must classify as calm. If a future
     refactor flips to `>=`, this test fires immediately. */
  /* avg=2, mult=1.5 -> threshold=3. Bar at 3 is calm; bar at 3.001 spikes. */
  assert.equal(walkbackSpikeStart([3], 2), 0);
  assert.equal(walkbackSpikeStart([3.001], 2), 0);
  assert.equal(walkbackSpikeStart([3, 3, 3], 2), 2);
  assert.equal(walkbackSpikeStart([3, 3, 3.001], 2), 2);
});

/* ─── classifyGemTiming ───────────────────────────────────────────── */

/* ─── gemScore100 — display normalization (G1 scanner audit) ────────── */

test('gemScore100 — the theoretical ceiling maps to exactly 100', () => {
  assert.equal(GEM_CONFIG.SCORE_MAX, 165); /* contract: denominator is the real max */
  assert.equal(gemScore100(GEM_CONFIG.SCORE_MAX), 100);
});

test('gemScore100 — SCORE_MIN floor lands at a sane low band, not near-zero', () => {
  /* The gate admits raw >= 35; on the true scale that reads ~21/100, which is
     why the legacy "50+ warn" color tier left almost every gem muted. */
  assert.equal(gemScore100(GEM_CONFIG.SCORE_MIN), 21); /* round(35/165*100) */
});

test('gemScore100 — a strong gem reads mid-scale, not "95/100"', () => {
  /* vx>=4 (45) + early (30) + 24h change (20) = 95 raw -> ~58, where the
     legacy display showed "95 pts" implying near-max. */
  assert.equal(gemScore100(95), 58); /* round(95/165*100) */
});

test('gemScore100 — clamps to [0,100] and rejects junk', () => {
  assert.equal(gemScore100(0), 0);
  assert.equal(gemScore100(-10), 0);
  assert.equal(gemScore100(NaN), 0);
  assert.equal(gemScore100(undefined), 0);
  assert.equal(gemScore100(999), 100); /* defensive: never exceeds 100 */
});

test('gemScore100 — monotonic non-decreasing in raw score', () => {
  let prev = -1;
  for (const raw of [0, 15, 35, 60, 95, 120, 140, 165]) {
    const p = gemScore100(raw);
    assert.ok(p >= prev, `not monotonic at raw=${raw}: ${p} < ${prev}`);
    prev = p;
  }
});

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

/* ─── gemEntryGate ────────────────────────────────────────────────── */

test('gemEntryGate — admits a bullish spike with strong momentum', () => {
  /* vx>=1.5 + early + gain>=0 */
  assert.equal(gemEntryGate(2.0, 'early', 1.5), true);
  /* vx>=1.5 + still + gain>=0 */
  assert.equal(gemEntryGate(1.5, 'still', 5), true);
  /* relaxed clause: 1.2<=vx<1.5 + early */
  assert.equal(gemEntryGate(1.3, 'early', 0.5), true);
  /* gain exactly 0 is still bullish enough (price at spike start) */
  assert.equal(gemEntryGate(1.5, 'early', 0), true);
});

test('gemEntryGate — rejects a bearish spike (negative gain) even with strong momentum', () => {
  /* This is the 2026-05-24 fix: classifyGemTiming maps negative gains
     to "early", so a volume spike on a FALLING price would otherwise
     surface as "Early — Enter!". The gate must veto it. */
  assert.equal(gemEntryGate(5.0, 'early', -0.5), false);
  assert.equal(gemEntryGate(2.0, 'still', -3), false);
  assert.equal(gemEntryGate(10, 'early', -0.01), false);
  /* NaN gain is rejected defensively. */
  assert.equal(gemEntryGate(2.0, 'early', NaN), false);
});

test('gemEntryGate — rejects weak momentum and late timing', () => {
  /* vx below the relaxed 1.2 floor */
  assert.equal(gemEntryGate(1.0, 'early', 1), false);
  assert.equal(gemEntryGate(0.3, 'early', 1), false);
  /* "still" needs the full 1.5x — the 1.2 relaxation is early-only */
  assert.equal(gemEntryGate(1.3, 'still', 1), false);
  /* late is always rejected, however strong the spike */
  assert.equal(gemEntryGate(5.0, 'late', 1), false);
});

/* ─── isLikelyStablecoin ──────────────────────────────────────────── */

test('isLikelyStablecoin — flags a flat $1 USD peg (the XUSD case)', () => {
  assert.equal(isLikelyStablecoin('XUSD', 1.0, 0.0), true);
  assert.equal(isLikelyStablecoin('XUSD', 0.999, 0.1), true);
  assert.equal(isLikelyStablecoin('USD1', 1.001, -0.2), true);
  /* change may be missing (feed not loaded) — marker + near-$1 decide */
  assert.equal(isLikelyStablecoin('XUSD', 1.0, null), true);
  assert.equal(isLikelyStablecoin('XUSD', 1.0, undefined), true);
});

test('isLikelyStablecoin — does NOT flag movers, off-peg, or non-USD symbols', () => {
  /* a real mover at $1 is not flat → not a peg */
  assert.equal(isLikelyStablecoin('XUSD', 1.0, 5), false);
  assert.equal(isLikelyStablecoin('XUSD', 1.0, -0.5), false); // |0.5| >= flat floor
  /* off the $1 peg */
  assert.equal(isLikelyStablecoin('XUSD', 0.5, 0), false);
  assert.equal(isLikelyStablecoin('XUSD', 1.5, 0), false);
  /* no USD marker → never a USD peg, even if flat at $1 */
  assert.equal(isLikelyStablecoin('PEPE', 1.0, 0.0), false);
  assert.equal(isLikelyStablecoin('HIVE', 1.0, 0.0), false);
  /* missing / invalid price */
  assert.equal(isLikelyStablecoin('XUSD', 0, 0), false);
  assert.equal(isLikelyStablecoin('', 1.0, 0), false);
});

test('isLikelyStablecoin — boundary tolerances', () => {
  /* comfortably within the 1% price band (kept off the exact 0.01 edge,
     which is float-sensitive: 1.01 - 1 === 0.01000000000000009) */
  assert.equal(isLikelyStablecoin('XUSD', 1.009, 0), true);
  assert.equal(isLikelyStablecoin('XUSD', 0.991, 0), true);
  /* clearly outside the 1% band */
  assert.equal(isLikelyStablecoin('XUSD', 1.02, 0), false);
  assert.equal(isLikelyStablecoin('XUSD', 0.98, 0), false);
  /* change exactly at the flat floor (0.5) is treated as a mover */
  assert.equal(isLikelyStablecoin('XUSD', 1.0, 0.5), false);
  assert.equal(isLikelyStablecoin('XUSD', 1.0, 0.49), true);
});

test('GEM_CONFIG.STABLES includes XUSD (explicit allow-list entry)', () => {
  assert.ok(GEM_CONFIG.STABLES.indexOf('XUSD') !== -1);
});

test('GEM_CONFIG scan funnel — score pool is wider than the render cap', () => {
  /* The scan funnel is prefilter -> score -> render. Two invariants keep
     the surge-weighted score doing real selection work; this is the
     regression guard for the 2026-05-24 selection fix, where
     SCORE_LIMIT(25) barely exceeded RENDER_LIMIT(20) so the score culled
     only ~5 candidates and selection collapsed to "top-N by raw volume". */
  assert.ok(
    GEM_CONFIG.SCORE_LIMIT <= GEM_CONFIG.PREFILTER_LIMIT,
    'SCORE_LIMIT must not exceed PREFILTER_LIMIT (never score beyond the shortlist)'
  );
  assert.ok(
    GEM_CONFIG.RENDER_LIMIT < GEM_CONFIG.SCORE_LIMIT,
    'RENDER_LIMIT must be strictly < SCORE_LIMIT so score-ranking actually selects'
  );
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
  ['USDT', 'USDC', 'DAI', 'FDUSD', 'USDE'].forEach((s) => {
    assert.ok(GEM_CONFIG.STABLES.indexOf(s) !== -1, s + ' missing from STABLES');
  });
});

test('GEM_CONFIG — stables list catches the production slip-throughs (USD1, RLUSD)', () => {
  /* These two showed up as "gems" in production because they are recent
     stablecoins not in the original list. Pin them so a future cleanup
     of STABLES cannot reintroduce the regression. */
  assert.ok(GEM_CONFIG.STABLES.indexOf('USD1') !== -1, 'USD1 must be in STABLES');
  assert.ok(GEM_CONFIG.STABLES.indexOf('RLUSD') !== -1, 'RLUSD must be in STABLES');
});

/* ─── gemTrackFirstSeen ───────────────────────────────────────────── */

test('gemTrackFirstSeen — fresh symbol gets firstSeen = lastSeen = now', () => {
  const state = {};
  const now = 1_700_000_000_000;
  gemTrackFirstSeen(state, ['BTC', 'ETH'], now);
  assert.deepEqual(state.BTC, { firstSeen: now, lastSeen: now });
  assert.deepEqual(state.ETH, { firstSeen: now, lastSeen: now });
});

test('gemTrackFirstSeen — recently-seen symbol preserves firstSeen', () => {
  const t0 = 1_700_000_000_000;
  const t1 = t0 + 5 * 60 * 1000; /* 5 min later — well within 30min default */
  const state = { BTC: { firstSeen: t0, lastSeen: t0 } };
  gemTrackFirstSeen(state, ['BTC'], t1);
  assert.equal(state.BTC.firstSeen, t0, 'firstSeen must be preserved');
  assert.equal(state.BTC.lastSeen, t1, 'lastSeen must refresh to current call');
});

test('gemTrackFirstSeen — long-absent symbol resets firstSeen', () => {
  /* Default missTimeoutMs is 30 min. A symbol unseen for 1h is treated
     as a re-appearance — firstSeen resets so the user does not see a
     stale "8 hours ago" age on what is effectively a fresh detection. */
  const t0 = 1_700_000_000_000;
  const t1 = t0 + 60 * 60 * 1000; /* 1h gap */
  const state = { BTC: { firstSeen: t0, lastSeen: t0 } };
  gemTrackFirstSeen(state, ['BTC'], t1);
  assert.equal(state.BTC.firstSeen, t1, 'firstSeen must reset after long absence');
  assert.equal(state.BTC.lastSeen, t1);
});

test('gemTrackFirstSeen — boundary: exactly missTimeoutMs preserves firstSeen', () => {
  /* The contract uses `<=` for "still on radar" — equality is in. */
  const t0 = 1_700_000_000_000;
  const miss = 30 * 60 * 1000;
  const state = { BTC: { firstSeen: t0, lastSeen: t0 } };
  gemTrackFirstSeen(state, ['BTC'], t0 + miss, miss);
  assert.equal(state.BTC.firstSeen, t0);
  /* Just past the boundary — resets. */
  const state2 = { BTC: { firstSeen: t0, lastSeen: t0 } };
  gemTrackFirstSeen(state2, ['BTC'], t0 + miss + 1, miss);
  assert.equal(state2.BTC.firstSeen, t0 + miss + 1);
});

test('gemTrackFirstSeen — symbols not in the current list are pruned only when stale', () => {
  /* A symbol seen earlier but not in the current syms list should
     remain (lastSeen unchanged) until staleMs elapses, then be pruned. */
  const t0 = 1_700_000_000_000;
  const stale = 24 * 60 * 60 * 1000;
  const state = {
    BTC: { firstSeen: t0, lastSeen: t0 + 60_000 } /* fresh — keep */,
    ETH: { firstSeen: t0, lastSeen: t0 } /* will be > stale away */,
  };
  /* Run with the current scan having no symbols, at a time just past
     stale relative to ETH but not BTC. */
  gemTrackFirstSeen(state, [], t0 + stale + 5_000);
  assert.ok(state.BTC, 'BTC should survive — not yet stale');
  assert.equal(state.ETH, undefined, 'ETH should be pruned');
});

test('gemTrackFirstSeen — handles null / missing inputs without throwing', () => {
  /* Defensive: localStorage might return null on first visit. */
  const out = gemTrackFirstSeen(null, ['BTC'], 1_700_000_000_000);
  assert.equal(typeof out, 'object');
  assert.ok(out.BTC);
  /* Missing syms array — no throw, stale entries pruned. */
  const state = { BTC: { firstSeen: 1, lastSeen: 1 } };
  gemTrackFirstSeen(state, null, 1_700_000_000_000);
  assert.equal(state.BTC, undefined);
});

test('gemTrackFirstSeen — empty / falsy symbols skipped, valid ones still tracked', () => {
  const state = {};
  gemTrackFirstSeen(state, ['BTC', '', null, undefined, 'ETH'], 1_700_000_000_000);
  assert.ok(state.BTC);
  assert.ok(state.ETH);
  assert.equal(state[''], undefined);
});

/* ─── resolveNotifTone ────────────────────────────────────────────── */

test('resolveNotifTone — soundEnabled=false short-circuits to silent', () => {
  /* Mute is global — it must beat any input, including direct user tones. */
  assert.equal(resolveNotifTone('ultra', 'bell', false), 'silent');
  assert.equal(resolveNotifTone('bell', 'horn', false), 'silent');
  assert.equal(resolveNotifTone(undefined, 'pulse', false), 'silent');
});

test("resolveNotifTone — explicit 'silent' input is silent", () => {
  assert.equal(resolveNotifTone('silent', 'bell', true), 'silent');
});

test('resolveNotifTone — severity inputs map to user soundPref', () => {
  /* This is the headline fix: 'ultra'/'whale'/'gem'/'breakout' used to
     fall through every previewTone branch and play NOTHING. Now they
     resolve to whatever tone the user picked in settings. */
  assert.equal(resolveNotifTone('ultra', 'horn', true), 'horn');
  assert.equal(resolveNotifTone('whale', 'pulse', true), 'pulse');
  assert.equal(resolveNotifTone('gem', 'bell', true), 'bell');
  assert.equal(resolveNotifTone('breakout', 'horn', true), 'horn');
});

test('resolveNotifTone — direct tone inputs pass through unchanged', () => {
  /* selTone() previews the tile the user just clicked — it must play
     THAT tone, not the saved preference. */
  assert.equal(resolveNotifTone('bell', 'horn', true), 'bell');
  assert.equal(resolveNotifTone('horn', 'bell', true), 'horn');
  assert.equal(resolveNotifTone('pulse', 'bell', true), 'pulse');
});

test('resolveNotifTone — unknown input + bad pref defaults to bell', () => {
  /* Defensive: a future caller introducing a new severity name should
     play SOMETHING audible rather than silently breaking. */
  assert.equal(resolveNotifTone('unknown_type', 'pulse', true), 'pulse');
  assert.equal(resolveNotifTone('unknown_type', 'invalid_pref', true), 'bell');
  assert.equal(resolveNotifTone('unknown_type', null, true), 'bell');
  assert.equal(resolveNotifTone(undefined, undefined, true), 'bell');
});

/* ─── isAlertEnabled ──────────────────────────────────────────────── */

test('isAlertEnabled — defaults ON for unset / null / non-object prefs', () => {
  /* Settings UI starts empty; users opting in to a key explicitly sets
     true; users opting out sets false. Anything else is treated as
     "user has not decided" → fire the alert. */
  assert.equal(isAlertEnabled(null, 'ultra'), true);
  assert.equal(isAlertEnabled(undefined, 'ultra'), true);
  assert.equal(isAlertEnabled({}, 'ultra'), true);
  assert.equal(isAlertEnabled('not-an-object', 'ultra'), true);
});

test('isAlertEnabled — false explicitly disables; true and missing enable', () => {
  assert.equal(isAlertEnabled({ ultra: false }, 'ultra'), false);
  assert.equal(isAlertEnabled({ ultra: true }, 'ultra'), true);
  assert.equal(isAlertEnabled({ ultra: false }, 'whale'), true);
  /* Subtle: only literal `false` disables. Truthy-coerce gotchas:
     0 / '' / null / undefined for the value all enable. The settings
     toggle only ever stores boolean true/false, so this matches the
     UI contract exactly. */
  assert.equal(isAlertEnabled({ ultra: 0 }, 'ultra'), true);
  assert.equal(isAlertEnabled({ ultra: null }, 'ultra'), true);
});

test('isAlertEnabled — missing key returns true (default ON)', () => {
  assert.equal(isAlertEnabled({ whale: false }, undefined), true);
  assert.equal(isAlertEnabled({ whale: false }, ''), true);
  assert.equal(isAlertEnabled({ whale: false }, null), true);
});

/* ─── notifHourBucket / notifDedupeKey ────────────────────────────── */

test('notifHourBucket — monotonic, increments by 1 per hour', () => {
  /* The bucket is Math.floor(epoch_ms / 3_600_000). Two timestamps
     in the same hour share a bucket; one hour apart, buckets differ
     by exactly 1. This is what eliminates the wall-clock collision
     bug where new Date().getHours() repeated every 24h. */
  const t = 1_700_000_000_000;
  const b0 = notifHourBucket(t);
  assert.equal(notifHourBucket(t + 60_000), b0, 'within hour same bucket');
  assert.equal(notifHourBucket(t + 3_600_000), b0 + 1, 'next hour +1');
  assert.equal(notifHourBucket(t + 24 * 3_600_000), b0 + 24, '24 hours +24');
});

test('notifHourBucket — defaults to Date.now() when called with no args', () => {
  /* Sanity: production callers omit `now`. Verify the helper returns
     a number close to "now" rather than throwing or returning 0. */
  const a = notifHourBucket();
  const b = notifHourBucket(Date.now());
  assert.ok(Math.abs(a - b) <= 1);
});

test('notifDedupeKey — shape is sym_type_bucket, deterministic', () => {
  const t = 1_700_000_000_000;
  const expectedBucket = Math.floor(t / 3_600_000);
  assert.equal(notifDedupeKey('BTC', 'ultra', t), 'BTC_ultra_' + expectedBucket);
  assert.equal(notifDedupeKey('BTC', 'whale', t), 'BTC_whale_' + expectedBucket);
});

test("notifDedupeKey — same coin/type within an hour collide; across hours don't", () => {
  const t = 1_700_000_000_000;
  assert.equal(notifDedupeKey('BTC', 'ultra', t), notifDedupeKey('BTC', 'ultra', t + 60_000));
  assert.notEqual(notifDedupeKey('BTC', 'ultra', t), notifDedupeKey('BTC', 'ultra', t + 3_600_000));
});

test('notifDedupeKey — different coins / types never collide in the same hour', () => {
  const t = 1_700_000_000_000;
  assert.notEqual(notifDedupeKey('BTC', 'ultra', t), notifDedupeKey('ETH', 'ultra', t));
  assert.notEqual(notifDedupeKey('BTC', 'ultra', t), notifDedupeKey('BTC', 'whale', t));
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

/* ─── 2026-05-21 stale-drawdown gate ─────────────────────────────
   The original drift gate above only catches +8% drift (missed the
   pump). A signal whose price has DROPPED significantly since
   detection is equally bad — represents a broken setup the user
   would chase. Motivating case: ETH detected at $2,363, current
   price $2,134 (-9.7% from detection), but the card still showed
   "🟢 إشارة قوية" because the score formula didn't penalise
   downward drift. The gate now rejects drift < -5% with reason
   'stale-drawdown'. */

test('qualityFilterRejectReason — stale-drawdown gate (drift < -5%)', () => {
  const base = {
    c: 0,
    passed: 5,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    tfAlign: { bearish4h: false },
  };
  /* -4.99% drift — does NOT fire (cutoff is strict <). */
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 95.01 }, { priceAtDetection: 100 }),
    null,
    '-4.99% is the cutoff'
  );
  /* -5% drift exactly — does NOT fire (strict <). */
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 95 }, { priceAtDetection: 100 }),
    null,
    '-5.0% is the boundary, NOT rejected'
  );
  /* -5.01% drift — fires. */
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 94.99 }, { priceAtDetection: 100 }),
    'stale-drawdown'
  );
  /* -9.7% — the ETH 2026-05-21 case. */
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 2134.19 }, { priceAtDetection: 2363.56 }),
    'stale-drawdown',
    'ETH 2026-05-21 case: -9.7% drift must be rejected'
  );
  /* -20% (severe) — fires. */
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 80 }, { priceAtDetection: 100 }),
    'stale-drawdown'
  );
});

test('qualityFilterRejectReason — drift gates are asymmetric (5 down, 8 up)', () => {
  /* The thresholds are deliberately asymmetric: downward drift is
     more dangerous (chasing a falling setup) than upward drift
     (missed a pump). Pin the asymmetry as a contract so a future
     refactor doesn't silently equalise them. */
  const base = {
    c: 0,
    passed: 5,
    smartEntry: { rr: 3 },
    pdFlags: 0,
    tfAlign: { bearish4h: false },
  };
  /* +7% drift — does NOT fire upward gate. */
  assert.equal(qualityFilterRejectReason({ ...base, p: 107 }, { priceAtDetection: 100 }), null);
  /* -7% drift — DOES fire downward gate. */
  assert.equal(
    qualityFilterRejectReason({ ...base, p: 93 }, { priceAtDetection: 100 }),
    'stale-drawdown'
  );
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

/* ─── capConfidenceForServerFlags ─────────────────────────────────── */

test('capConfidenceForServerFlags — non-array / empty / irrelevant tags pass conf through', () => {
  assert.equal(capConfidenceForServerFlags(90, null), 90);
  assert.equal(capConfidenceForServerFlags(90, undefined), 90);
  assert.equal(capConfidenceForServerFlags(90, 'nope'), 90);
  assert.equal(capConfidenceForServerFlags(90, []), 90);
  assert.equal(capConfidenceForServerFlags(90, ['📈RISING', '🐋WHALE']), 90);
});

test('capConfidenceForServerFlags — a plain server demotion caps ULTRA confidence at 84', () => {
  assert.equal(capConfidenceForServerFlags(92, ['🛑SRV_DEMOTE']), 84);
  assert.equal(capConfidenceForServerFlags(85, ['🛑SRV_DEMOTE']), 84);
  /* Never raises: an already-lower conf is left untouched. */
  assert.equal(capConfidenceForServerFlags(70, ['🛑SRV_DEMOTE']), 70);
});

test('capConfidenceForServerFlags — hard-risk flags cap below the enter verdict (69)', () => {
  assert.equal(capConfidenceForServerFlags(95, ['🚨MANIP_HIGH']), 69);
  assert.equal(capConfidenceForServerFlags(80, ['🔪FALLING']), 69);
  /* P&D_RISK carries a count suffix, so it is matched by prefix. */
  assert.equal(capConfidenceForServerFlags(88, ['🚨P&D_RISK:3/5']), 69);
  /* Already below the cap → unchanged. */
  assert.equal(capConfidenceForServerFlags(50, ['🚨MANIP_HIGH']), 50);
});

test('capConfidenceForServerFlags — hard risk wins over a plain demotion', () => {
  assert.equal(capConfidenceForServerFlags(95, ['🛑SRV_DEMOTE', '🚨MANIP_HIGH']), 69);
});

test('capConfidenceForServerFlags — non-string entries are ignored, not thrown on', () => {
  assert.equal(capConfidenceForServerFlags(90, [null, 42, {}, '🛑SRV_DEMOTE']), 84);
});

/* ─── regimeConfAdjustment — market-direction alignment ───────────── */

const RANGING = { regime: 'ranging', inputs: { btcAgreement: 'mixed' } };
const TREND_DOWN = { regime: 'trending', inputs: { btcAgreement: 'bearish' } };
const TREND_DOWN_STRONG = {
  regime: 'trending',
  trendScore: 3,
  inputs: { btcAgreement: 'bearish' },
};
const TREND_UP = { regime: 'trending', inputs: { btcAgreement: 'bullish' } };

test('regimeConfAdjustment — ranging regime never adjusts (contrarian edge intact)', () => {
  assert.equal(regimeConfAdjustment(RANGING, ['📉BOTTOM']), 0);
  assert.equal(regimeConfAdjustment(RANGING, ['📈RISING', '🎯AT_HIGH']), 0);
});

test('regimeConfAdjustment — downtrend scales the dip-buy penalty with trend strength', () => {
  /* momentum/plain long fighting the downtrend → heavy penalty regardless of strength */
  assert.equal(regimeConfAdjustment(TREND_DOWN, ['📈RISING']), -12);
  assert.equal(regimeConfAdjustment(TREND_DOWN, []), -12);
  assert.equal(regimeConfAdjustment(TREND_DOWN_STRONG, ['📈RISING']), -12);
  /* dip-buy / reversal: lighter in a moderate downtrend (−5)… */
  assert.equal(regimeConfAdjustment(TREND_DOWN, ['🔄REVERSAL']), -5);
  assert.equal(regimeConfAdjustment(TREND_DOWN, ['📉RSI_OS']), -5);
  assert.equal(regimeConfAdjustment(TREND_DOWN, ['🩳SHORTS']), -5);
  /* …but near-momentum in a strong downtrend (−10): a "dip" is the next leg down */
  assert.equal(regimeConfAdjustment(TREND_DOWN_STRONG, ['🔄REVERSAL']), -10);
  assert.equal(regimeConfAdjustment(TREND_DOWN_STRONG, ['📉RSI_OS']), -10);
});

test('regimeConfAdjustment — uptrend rewards trend-aligned momentum only', () => {
  assert.equal(regimeConfAdjustment(TREND_UP, ['🎯AT_HIGH']), 8);
  assert.equal(regimeConfAdjustment(TREND_UP, ['📊MACD_BULL']), 8);
  assert.equal(regimeConfAdjustment(TREND_UP, ['📉BOTTOM']), 0); // contrarian → no boost
});

test('regimeConfAdjustment — trending-but-mixed bias is neutral', () => {
  assert.equal(
    regimeConfAdjustment({ regime: 'trending', inputs: { btcAgreement: 'mixed' } }, []),
    0
  );
});

test('regimeConfAdjustment — malformed regime / tags degrade to 0', () => {
  assert.equal(regimeConfAdjustment(null, ['📈RISING']), 0);
  assert.equal(regimeConfAdjustment({}, ['📈RISING']), 0);
  assert.equal(regimeConfAdjustment(RANGING, 'oops'), 0);
  /* trending-down with non-array tags → treated as no reversal → heavy penalty */
  assert.equal(regimeConfAdjustment(TREND_DOWN, null), -12);
});

/* ─── gemMcGate — market-cap gate with an explicit unknown-MC policy (G3) ── */

test('gemMcGate — known MC inside the band is not rejected', () => {
  assert.equal(gemMcGate(5e6, 1e6, 1e8, false), false);
  assert.equal(gemMcGate(5e6, 1e6, 1e8, true), false);
});

test('gemMcGate — known MC below min or above max is rejected (band enforced)', () => {
  assert.equal(gemMcGate(5e5, 1e6, 1e8, false), true); /* below min */
  assert.equal(gemMcGate(5e8, 1e6, 1e8, false), true); /* above max */
});

test('gemMcGate — band edges are inclusive (min/max themselves pass)', () => {
  assert.equal(gemMcGate(1e6, 1e6, 1e8, false), false); /* == min */
  assert.equal(gemMcGate(1e8, 1e6, 1e8, false), false); /* == max */
});

test('gemMcGate — unknown MC passes by default (legacy parity, strict off)', () => {
  assert.equal(gemMcGate(null, 1e6, 1e8, false), false);
  assert.equal(gemMcGate(undefined, 1e6, 1e8, false), false);
  assert.equal(gemMcGate(0, 1e6, 1e8, false), false);
});

test('gemMcGate — unknown MC is rejected in strict mode (the G3 fix)', () => {
  assert.equal(gemMcGate(null, 1e6, 1e8, true), true);
  assert.equal(gemMcGate(undefined, 1e6, 1e8, true), true);
  assert.equal(gemMcGate(0, 1e6, 1e8, true), true);
});

test('gemMcGate — strict-off is byte-for-byte the legacy inline gate', () => {
  /* legacy: mc != null && mc > 0 && (mc < min || mc > max) */
  function legacy(mc, min, max) {
    return mc != null && mc > 0 && (mc < min || mc > max);
  }
  const min = 2e6,
    max = 5e7;
  for (const mc of [null, undefined, 0, 1, 1e6, 2e6, 1e7, 5e7, 9e7, -5]) {
    assert.equal(gemMcGate(mc, min, max, false), legacy(mc, min, max), 'mc=' + mc);
  }
});

/* ─── classifyFreshness (scalp-freshness audit, 2026-06) ──────────────── */

test('classifyFreshness — small age + small drift is fresh', () => {
  assert.equal(classifyFreshness(5, 0.5, 'daily'), 'fresh');
  assert.equal(classifyFreshness(2, -0.5, 'daily'), 'fresh');
});

test('classifyFreshness — the BNB case: an adverse (down) long stales to old', () => {
  /* BNB: detected 57m ago, price FELL 4.9% since (long thesis failing). The
     legacy |drift| daily gate (drOld=5) called this "warm / still an
     opportunity"; a 4.9% drawdown on a long must read 'old'. */
  assert.equal(classifyFreshness(57, -4.9, 'daily'), 'old');
  assert.equal(classifyFreshness(5, -3, 'daily'), 'old'); /* adv 3 > advOld 2.5 */
});

test('classifyFreshness — the ZEC case: a favorable (up) long is unchanged (no regression)', () => {
  /* ZEC: 22m ago, +2.8% since — late but working. Stays 'warm' exactly as the
     legacy gate had it (favorable side keeps the |drift| thresholds). */
  assert.equal(classifyFreshness(22, 2.8, 'daily'), 'warm');
  assert.equal(classifyFreshness(5, 6, 'daily'), 'old'); /* fav 6 > favOld 5 = too late */
});

test('classifyFreshness — direction asymmetry: a drop stales sooner than an equal rise', () => {
  /* Same magnitude, opposite outcome — the core #2 fix. */
  assert.equal(classifyFreshness(5, -3, 'daily'), 'old');
  assert.equal(classifyFreshness(5, 3, 'daily'), 'warm');
  assert.equal(classifyFreshness(5, -1.5, 'daily'), 'warm'); /* adv 1.5 > advWarm 1 */
  assert.equal(classifyFreshness(5, 1.5, 'daily'), 'fresh'); /* fav 1.5 < favWarm 2 */
});

test('classifyFreshness — favorable side is byte-for-byte the legacy |drift| daily gate', () => {
  function legacy(age, drift) {
    const drOld = 5,
      drWarm = 2,
      agOld = 60,
      agWarm = 15;
    if (age > agOld || Math.abs(drift) > drOld) return 'old';
    if (age > agWarm || Math.abs(drift) > drWarm) return 'warm';
    return 'fresh';
  }
  /* For non-negative drift the new gate must match the old one exactly. */
  for (const age of [0, 10, 16, 61]) {
    for (const d of [0, 1, 2, 2.01, 5, 5.01, 9]) {
      assert.equal(classifyFreshness(age, d, 'daily'), legacy(age, d), `age=${age} d=${d}`);
    }
  }
});

test('classifyFreshness — fast scalps get the tight gates, on both sides', () => {
  assert.equal(classifyFreshness(5, 1.6, 'fast'), 'old'); /* fav 1.6 > favOld 1.5 */
  assert.equal(classifyFreshness(5, -1.1, 'fast'), 'old'); /* adv 1.1 > advOld 1.0 */
  assert.equal(classifyFreshness(5, -0.6, 'fast'), 'warm'); /* adv 0.6 > advWarm 0.5 */
  assert.equal(classifyFreshness(5, 0.5, 'fast'), 'fresh');
  assert.equal(classifyFreshness(31, 0, 'fast'), 'old'); /* age > 30 */
  assert.equal(classifyFreshness(11, 0, 'fast'), 'warm'); /* age > 10 */
});

test('classifyFreshness — age gates fire independent of drift', () => {
  assert.equal(classifyFreshness(61, 0, 'daily'), 'old');
  assert.equal(classifyFreshness(16, 0, 'daily'), 'warm');
});

test('classifyFreshness — junk input degrades to fresh, never throws; opts override', () => {
  assert.equal(classifyFreshness(NaN, NaN, 'daily'), 'fresh');
  assert.equal(classifyFreshness('x', 'y', 'daily'), 'fresh');
  assert.equal(classifyFreshness(57, -4.9, undefined), 'old'); /* unknown type → daily gates */
  /* opts widen the favorable-warm gate so +3% no longer warms. */
  assert.equal(classifyFreshness(5, 3, 'daily', { favWarm: 5 }), 'fresh');
});

/* ─── scalpVerdictAllowsEntry (#4 scalp-CTA audit) ────────────────────── */

test('scalpVerdictAllowsEntry — enters only when the verdict says enter (conf>=70 & not stale)', () => {
  assert.equal(scalpVerdictAllowsEntry(85, 'fresh'), true); /* Excellent / Strong */
  assert.equal(
    scalpVerdictAllowsEntry(72, 'warm'),
    true
  ); /* Good — Enter Carefully (warm allowed) */
  assert.equal(scalpVerdictAllowsEntry(70, 'fresh'), true); /* boundary */
});

test('scalpVerdictAllowsEntry — monitor verdicts block entry (conf<70)', () => {
  assert.equal(scalpVerdictAllowsEntry(69, 'fresh'), false); /* Moderate — Monitor */
  assert.equal(scalpVerdictAllowsEntry(55, 'warm'), false);
  assert.equal(scalpVerdictAllowsEntry(40, 'fresh'), false); /* Watch Only */
});

test('scalpVerdictAllowsEntry — a stale signal never allows entry, even at high conf', () => {
  /* the BNB-class case: conf could be high but freshness=old → watch only. */
  assert.equal(scalpVerdictAllowsEntry(90, 'old'), false);
  assert.equal(scalpVerdictAllowsEntry(70, 'old'), false);
});

test('scalpVerdictAllowsEntry — junk conf is false; minConf override works', () => {
  assert.equal(scalpVerdictAllowsEntry(NaN, 'fresh'), false);
  assert.equal(scalpVerdictAllowsEntry(undefined, 'fresh'), false);
  assert.equal(scalpVerdictAllowsEntry(65, 'fresh', 60), true); /* lowered floor */
  assert.equal(scalpVerdictAllowsEntry(75, 'fresh', 80), false); /* raised floor */
});

/* ─── autoMinScore / scanPresetFloor (auto scanner quality filter, #6) ─── */

test('autoMinScore — risk-off tape (bear OR high-vol) raises the floor to STRONG (70)', () => {
  assert.equal(autoMinScore({ direction: 'bear', volatility: 'normal' }), 70);
  assert.equal(autoMinScore({ direction: 'bull', volatility: 'high' }), 70); /* fast tape */
  assert.equal(autoMinScore({ direction: 'none', volatility: 'high' }), 70);
});

test('autoMinScore — a healthy / ranging normal-vol tape uses the balanced MEDIUM floor (50)', () => {
  assert.equal(autoMinScore({ direction: 'bull', volatility: 'normal' }), 50);
  assert.equal(autoMinScore({ direction: 'none', volatility: 'normal' }), 50);
});

test('autoMinScore — cold / malformed regime degrades to the balanced default', () => {
  assert.equal(autoMinScore(), 50);
  assert.equal(autoMinScore(null), 50);
  assert.equal(autoMinScore('oops'), 50);
  assert.equal(autoMinScore({}), 50);
});

test('scanPresetFloor — all/strong are fixed; auto delegates to the regime', () => {
  assert.equal(scanPresetFloor('all', { direction: 'bear' }), 30); /* escape hatch */
  assert.equal(scanPresetFloor('strong', { direction: 'bull' }), 70);
  assert.equal(scanPresetFloor('auto', { direction: 'bear' }), 70); /* risk-off */
  assert.equal(scanPresetFloor('auto', { direction: 'bull', volatility: 'normal' }), 50);
  assert.equal(scanPresetFloor('xyz', { direction: 'bear' }), 70); /* unknown mode → auto */
  assert.equal(scanPresetFloor(undefined, {}), 50);
});

/* ─── scalpDailyPlan (#5 live levels) ─────────────────────────────────── */

test('scalpDailyPlan — prefers live server levels when they bracket price (the #5 fix)', () => {
  assert.deepEqual(scalpDailyPlan(100, 108, 96, false, true), {
    entry: 100,
    target: 108,
    stop: 96,
    live: true,
  });
});

test('scalpDailyPlan — falls back to the fixed ladder when live levels are absent/insane', () => {
  assert.deepEqual(scalpDailyPlan(100, undefined, undefined, false, true), {
    entry: 99.5,
    target: 106,
    stop: 97,
    live: false,
  });
  assert.equal(scalpDailyPlan(100, 95, 90, false, true).live, false); /* tp1 below price */
  assert.equal(scalpDailyPlan(100, 108, 101, false, true).live, false); /* sl above price */
  assert.equal(scalpDailyPlan(100, 108, 0, false, true).live, false); /* sl<=0 */
});

test('scalpDailyPlan — ultra widens the fixed target to +8%', () => {
  assert.equal(scalpDailyPlan(100, NaN, NaN, true, true).target, 108);
  assert.equal(scalpDailyPlan(100, NaN, NaN, false, true).target, 106);
});

test('scalpDailyPlan — useLive=off is byte-for-byte the legacy fixed ladder', () => {
  assert.deepEqual(scalpDailyPlan(200, 220, 190, false, false), {
    entry: 199,
    target: 212,
    stop: 194,
    live: false,
  });
});

/* ─── fallingKnifePenalty (#7) ────────────────────────────────────────── */

test('fallingKnifePenalty — the BNB case: hard dump + sub-threshold whale → penalised', () => {
  assert.equal(fallingKnifePenalty(-6.1, 46), -10); /* -5..-8, whale<50 */
  assert.equal(fallingKnifePenalty(-9, 30), -18); /* deep dump */
});

test('fallingKnifePenalty — mild dips are untouched (contrarian thesis preserved)', () => {
  assert.equal(fallingKnifePenalty(-3, 0), 0);
  assert.equal(fallingKnifePenalty(-5, 0), 0); /* boundary: -5 is not < -5 */
  assert.equal(fallingKnifePenalty(2, 0), 0); /* up day */
});

test('fallingKnifePenalty — whale accumulation waives it (mirrors #169, bar 50)', () => {
  assert.equal(fallingKnifePenalty(-9, 50), 0); /* whale >= 50 exempt */
  assert.equal(fallingKnifePenalty(-9, 49), -18); /* just under → penalised */
});

test('fallingKnifePenalty — junk input is 0; no-whale-data is NOT exempt; thresholds tunable', () => {
  assert.equal(fallingKnifePenalty(NaN, 0), 0);
  assert.equal(fallingKnifePenalty(-6, NaN), -10); /* unknown whale → not exempt */
  assert.equal(fallingKnifePenalty(-6, 0, { dumpPct: -10 }), 0); /* raise the dump bar */
});

/* ─── scalpConfFloor (separate-scopes: decouple the scalp gate from Monitor) ── */

test('scalpConfFloor — single-gate (default on) is a fixed 40, ignoring the Monitor', () => {
  assert.equal(scalpConfFloor(55, true), 40);
  assert.equal(scalpConfFloor(75, true), 40); /* Monitor raised to 75 → ignored */
  assert.equal(scalpConfFloor(undefined, true), 40);
  assert.equal(scalpConfFloor(NaN, true), 40);
});

test('scalpConfFloor — legacy (off) tracks the Monitor floor (minConf-10, min 35)', () => {
  assert.equal(scalpConfFloor(55, false), 45); /* default Monitor minConf */
  assert.equal(scalpConfFloor(75, false), 65); /* Monitor tightened after losses */
  assert.equal(scalpConfFloor(40, false), 35); /* max(35, 30) clamps at 35 */
  assert.equal(scalpConfFloor(undefined, false), 40); /* no Monitor → legacy 40 */
  assert.equal(scalpConfFloor(NaN, false), 40);
});

/* ─── dataSourceHealth (#1 monitor audit: honest data-source health %) ─── */

test('dataSourceHealth — pct is alive/total and names the dead sources', () => {
  const r = dataSourceHealth([
    { name: 'Prices', count: 800 },
    { name: 'FR', count: 700 },
    { name: 'Bitfinex', count: 0 },
    { name: 'Coinalyze', count: 50 },
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.alive, 3);
  assert.equal(r.pct, 75);
  assert.deepEqual(r.down, ['Bitfinex']);
});

test('dataSourceHealth — all alive = 100, all dead = 0', () => {
  assert.equal(
    dataSourceHealth([
      { name: 'a', count: 1 },
      { name: 'b', count: 5 },
    ]).pct,
    100
  );
  assert.equal(
    dataSourceHealth([
      { name: 'a', count: 0 },
      { name: 'b', count: 0 },
    ]).pct,
    0
  );
});

test('dataSourceHealth — { optional:true } sources are excluded from the score', () => {
  const r = dataSourceHealth([
    { name: 'Prices', count: 800 },
    { name: 'News', count: 0, optional: true },
  ]);
  assert.equal(r.total, 1); /* News doesn't count */
  assert.equal(r.pct, 100);
});

test('dataSourceHealth — junk input is safe (0/empty, never throws)', () => {
  assert.deepEqual(dataSourceHealth(null), { pct: 0, alive: 0, total: 0, down: [] });
  assert.deepEqual(dataSourceHealth([]), { pct: 0, alive: 0, total: 0, down: [] });
  const r = dataSourceHealth([{ name: 'x', count: 'abc' }, null]); /* NaN count, null entry */
  assert.equal(r.total, 1);
  assert.equal(r.alive, 0);
  assert.deepEqual(r.down, ['x']);
});

/* ─── supervisorGrade (#4 monitor audit: data vs performance basis) ───── */

test('supervisorGrade — performance basis matches the legacy blend when trades exist', () => {
  const r = supervisorGrade({
    scanRate: 75,
    whaleRate: 65,
    apiRate: 96,
    totalPnl: 1,
    disconnects: 0,
    tradeSample: 10,
  });
  assert.equal(r.basis, 'performance');
  assert.equal(r.grade, 30 + 20 + 20 + 15 + 15); /* 100 */
  assert.equal(r.gradeLabel, 'A');
});

test('supervisorGrade — no/low trades → data basis from API+uptime only (the #4 fix)', () => {
  /* the no-trade case: scanRate/whaleRate/PnL all 0, good API+uptime → "Data A",
     NOT a misleading performance "C". */
  const r = supervisorGrade({
    scanRate: 0,
    whaleRate: 0,
    apiRate: 96,
    totalPnl: 0,
    disconnects: 0,
    tradeSample: 0,
    whaleSample: 0,
  });
  assert.equal(r.basis, 'data');
  assert.equal(r.grade, 100); /* 50 (api) + 50 (uptime) */
  assert.equal(r.gradeLabel, 'A');
});

test('supervisorGrade — tradeSample = trades + whales vs minSample (overridable)', () => {
  assert.equal(
    supervisorGrade({ tradeSample: 3, whaleSample: 3, apiRate: 96 }).basis,
    'performance'
  );
  assert.equal(supervisorGrade({ tradeSample: 2, whaleSample: 2, apiRate: 96 }).basis, 'data');
  assert.equal(supervisorGrade({ tradeSample: 10, minSample: 20 }).basis, 'data');
});

test('supervisorGrade — degraded data lowers the data grade; junk input is safe', () => {
  assert.ok(
    supervisorGrade({ apiRate: 50, disconnects: 5, tradeSample: 0 }).grade < 50
  ); /* 12+16 → D */
  const j = supervisorGrade();
  assert.equal(j.basis, 'data');
  assert.ok(j.grade >= 0 && j.grade <= 100);
});
