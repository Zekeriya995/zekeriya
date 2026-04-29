const test = require('node:test');
const assert = require('node:assert/strict');

require('./_setup.js');

test('fmt — formats currency in B/M/K/$ buckets', () => {
  assert.equal(fmt(1.5e9), '$1.5B');
  assert.equal(fmt(2.3e6), '$2.3M');
  assert.equal(fmt(4500), '$4.5K');
  assert.equal(fmt(123), '$123');
  assert.equal(fmt(0), '$0');
});

test('fP — adapts precision to magnitude', () => {
  assert.equal(fP(0), '$0');
  assert.equal(fP(NaN), '$0');
  assert.equal(fP(0.0001234), '$0.000123');
  assert.equal(fP(0.5), '$0.5000');
  assert.equal(fP(12.345), '$12.35');
  assert.equal(fP(1234.5), '$1,234.5');
});

test('esc — escapes the five HTML-significant characters', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
  assert.equal(esc('plain'), 'plain');
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('"quote"'), '&quot;quote&quot;');
  assert.equal(esc("it's"), 'it&#39;s');
});

test('h — tagged template auto-escapes interpolations', () => {
  const name = '<img onerror=x>';
  assert.equal(h`<div>${name}</div>`, '<div>&lt;img onerror=x&gt;</div>');
});

test('h — rawHtml() escape hatch passes value through unescaped', () => {
  const safe = rawHtml('<b>OK</b>');
  assert.equal(h`row: ${safe}`, 'row: <b>OK</b>');
});

test('h — null / undefined / numbers interpolate cleanly', () => {
  assert.equal(h`${null}-${undefined}-${0}-${42}`, '--0-42');
});

test('safeC — NaN-safe change %', () => {
  assert.equal(safeC(0), 0);
  assert.equal(safeC(NaN), 0);
  assert.equal(safeC(undefined), 0);
  assert.equal(safeC(null), 0);
  assert.equal(safeC(3.14), 3.14);
  assert.equal(safeC(-2), -2);
});

test('calcRSI — empty / short series falls back to neutral 50', () => {
  assert.equal(calcRSI([], 14), 50);
  assert.equal(calcRSI([1, 2, 3], 14), 50);
  assert.equal(calcRSI(null, 14), 50);
});

test('calcRSI — perfectly flat series returns neutral 50 (AUDIT-F6)', () => {
  /* When BOTH gains and losses are zero the RS ratio is 0/0 and the
     value is genuinely undefined. The earlier code reached the
     `avgL === 0` branch first and returned 100 — a flat market does
     not deserve an "extreme overbought" reading. Convention: 50. */
  assert.equal(calcRSI(Array(30).fill(50), 14), 50);
});

test('calcRSI — gains with no losses still returns 100 (Wilder convention)', () => {
  /* A genuinely one-sided series (any non-zero gain, zero loss) IS
     overbought. The 100 path is preserved for that case. */
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(calcRSI(closes, 14), 100);
});

test('calcRSI — monotone-up series saturates near 100', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const rsi = calcRSI(closes, 14);
  assert.ok(rsi > 95, `expected RSI > 95, got ${rsi}`);
});

test('calcRSI — monotone-down series collapses near 0', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
  const rsi = calcRSI(closes, 14);
  assert.ok(rsi < 5, `expected RSI < 5, got ${rsi}`);
});

test('calcRSI — matches hand-computed Wilder value on a small series', () => {
  /* RSI(2) on [1,2,3,2,1,2,3]:
       seed after i=1..2: avgG = 1, avgL = 0
       j=3: avgG = 0.5,   avgL = 0.5
       j=4: avgG = 0.25,  avgL = 0.75
       j=5: avgG = 0.625, avgL = 0.375
       j=6: avgG = 0.8125, avgL = 0.1875
       RS = 4.333…, RSI = 100 - 100/5.333… = 81.25
     Hand-verified value — catches any regression in seeding or
     recurrence direction. */
  assert.equal(calcRSI([1, 2, 3, 2, 1, 2, 3], 2), 81.25);
});

test('calcEMA — period larger than data returns null', () => {
  assert.equal(calcEMA([10, 20, 30], 5), null);
  assert.equal(calcEMA([], 5), null);
  assert.equal(calcEMA(null, 5), null);
  assert.equal(calcEMA(undefined, 5), null);
});

test('calcEMA — flat series equals the constant', () => {
  assert.equal(calcEMA([5, 5, 5, 5, 5], 3), 5);
});

test('calcEMA — length === period returns SMA of the seed window', () => {
  /* When data.length === period there is no recurrence step, so the
     result is the SMA of the seed window — not an error, not the last
     value. The old implementation returned SMA by coincidence; the new
     one returns it by construction. */
  assert.equal(calcEMA([1, 2, 3, 4, 5], 5), 3);
  assert.equal(calcEMA([10, 20, 30, 40], 4), 25);
});

test('calcEMA — recurrence weights recent values more than SMA', () => {
  /* Rising series: EMA should be higher than SMA of the full window
     because recent (larger) values dominate the recurrence. */
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const ema = calcEMA(closes, 20);
  assert.ok(ema > sma, `expected EMA (${ema}) > SMA (${sma})`);
  assert.ok(ema < closes[closes.length - 1], `expected EMA < last`);
});

test('calcEMA — decaying series gives EMA below SMA', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const ema = calcEMA(closes, 20);
  assert.ok(ema < sma, `expected EMA (${ema}) < SMA (${sma})`);
});

test('calcMACD — too-short series returns zeros', () => {
  const r = calcMACD([1, 2, 3]);
  assert.deepEqual(r, { h: 0, signal: 0, cross: 'none' });
});

test('calcMACD — flat series returns zero MACD + no cross', () => {
  const flat = Array(40).fill(100);
  const r = calcMACD(flat);
  assert.equal(r.h, 0);
  assert.equal(r.signal, 0);
  assert.equal(r.cross, 'none');
});

/* Sinusoidal close series — oscillates above/below trend reliably,
   producing real (prevMacd < prevSig → curMacd > curSig) bull/bear
   crosses without the touch-the-line edge case. Used by the next two
   tests after AUDIT-MACD tightened cross detection from `<=` to `<`. */
function makeSineCloses(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(100 + 30 * Math.sin(i / 8));
  return out;
}

test('calcMACD — detects a genuine bearish cross (AUDIT-MACD)', () => {
  /* Sine wave at index 69 has prev MACD strictly above signal and
     current MACD below — a real cross. The earlier `<=`-based test
     fixture only worked because `prevMacd === prevSig` was being
     mistreated as a cross. */
  const closes = makeSineCloses(69);
  const r = calcMACD(closes);
  assert.equal(r.cross, 'bear');
  assert.ok(r.h < r.signal);
});

test('calcMACD — detects a genuine bullish cross (AUDIT-MACD)', () => {
  const closes = makeSineCloses(94);
  const r = calcMACD(closes);
  assert.equal(r.cross, 'bull');
  assert.ok(r.h > r.signal);
});

test('calcMACD — touch (prevMacd === prevSig) does NOT fire cross (AUDIT-MACD)', () => {
  /* A perfectly flat signal section (curSig === prevSig === curMacd ===
     prevMacd) used to fire `bull` because of the old `prevMacd <= prevSig`.
     With strict `<` the touch is not a cross. Construct: a series that
     hits a stable plateau where MACD ≈ signal, and confirm `cross` is
     `none`. */
  const flat = Array(40).fill(100);
  const r = calcMACD(flat);
  assert.equal(r.cross, 'none');
});

test('calcMACD — steady uptrend produces positive MACD, no cross', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const r = calcMACD(closes);
  assert.ok(r.h > 0, `expected positive MACD, got ${r.h}`);
  assert.equal(r.cross, 'none');
});

test('calcATR — too-short / missing input returns null', () => {
  assert.equal(calcATR(null, 14), null);
  assert.equal(calcATR([], 14), null);
  /* period + 1 bars are required (one prior close needed for TR) */
  assert.equal(calcATR([[0, 1, 2, 0.5, 1.5, 10]], 14), null);
});

test('calcATR — flat OHLC series returns 0', () => {
  const bars = Array.from({ length: 30 }, (_, i) => [i, 10, 10, 10, 10, 1]);
  assert.equal(calcATR(bars, 14), 0);
});

test('calcATR — constant TR of 1 collapses to ATR = 1', () => {
  /* Every bar: high=11, low=10, close=10.5, so TR = max(1, 0.5, 0.5) = 1. */
  const bars = Array.from({ length: 30 }, (_, i) => [i, 10, 11, 10, 10.5, 1]);
  const atr = calcATR(bars, 14);
  assert.ok(Math.abs(atr - 1) < 1e-9, `expected ATR ≈ 1, got ${atr}`);
});

test('calcATR — responds to a spike via Wilder smoothing', () => {
  /* 20 calm bars (TR ≈ 1) then 5 volatile bars (TR ≈ 5). Wilder smoothing
     lifts ATR above the calm baseline but not all the way to the spike. */
  const calm = Array.from({ length: 20 }, (_, i) => [i, 10, 11, 10, 10.5, 1]);
  const spike = Array.from({ length: 5 }, (_, i) => [20 + i, 10, 15, 10, 12, 1]);
  const atr = calcATR(calm.concat(spike), 14);
  assert.ok(atr > 1, `expected ATR > 1 after spike, got ${atr}`);
  assert.ok(atr < 5, `expected ATR < 5 (Wilder smoothing), got ${atr}`);
});

test('calcPearson — identical series → +1', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.equal(calcPearson(a, a), 1);
});

test('calcPearson — negated series → -1', () => {
  const a = [1, 2, 3, 4, 5, 6];
  const b = a.map((v) => -v);
  assert.equal(calcPearson(a, b), -1);
});

test('calcPearson — affine transform preserves +1 correlation', () => {
  /* y = 3x + 7 is a perfect positive linear relationship. */
  const a = [1, 2, 3, 4, 5, 6];
  const b = a.map((v) => 3 * v + 7);
  assert.ok(Math.abs(calcPearson(a, b) - 1) < 1e-12);
});

test('calcPearson — missing / too-short / flat input returns null', () => {
  assert.equal(calcPearson(null, [1, 2, 3]), null);
  assert.equal(calcPearson([1, 2, 3], undefined), null);
  assert.equal(calcPearson([1], [1]), null);
  assert.equal(calcPearson([1, 1, 1, 1], [1, 2, 3, 4]), null);
  assert.equal(calcPearson([1, 2, 3, 4], [5, 5, 5, 5]), null);
});

test('calcPearson — uses the tail when lengths differ', () => {
  /* Last 3 bars of each series are identical → perfect +1. */
  const a = [999, 777, 1, 2, 3];
  const b = [1, 2, 3];
  assert.equal(calcPearson(a, b), 1);
});

test('calcPearson — known hand-computed value', () => {
  /* x = [1,2,3,4,5], y = [2,4,5,4,5]:
       mean_x = 3, mean_y = 4
       dx = [-2,-1,0,1,2], dy = [-2,0,1,0,1]
       Σ dx·dy = 4+0+0+0+2 = 6
       Σ dx² = 10, Σ dy² = 6
       r = 6 / sqrt(60) ≈ 0.7745966… */
  const r = calcPearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  assert.ok(Math.abs(r - 6 / Math.sqrt(60)) < 1e-12);
});
