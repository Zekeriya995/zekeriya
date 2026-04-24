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
    { time: now - 1 * 60 * 1000 },  // 1 min ago  — inside
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
    checked: true, hit: i % 2 === 0, score: 50, pnl: i % 2 === 0 ? 2 : -1,
  }));
  assert.equal(computePerformanceReport(few, []).recentTrend.length, 0);
  const plenty = Array.from({ length: 75 }, (_, i) => ({
    checked: true, hit: i % 2 === 0, score: 50, pnl: i % 2 === 0 ? 2 : -1,
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
