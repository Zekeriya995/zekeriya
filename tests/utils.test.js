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
});

test('calcRSI — monotone-up series saturates near 100', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
  const rsi = calcRSI(closes, 14);
  assert.ok(rsi > 95, `expected RSI > 95, got ${rsi}`);
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
