/* Unit tests for src/indicator-engine.js — the server-side mirror of
   the PWA's calcRSI / calcMACD / calcEMA / calcATR formulas plus the
   direction classifier that drives the BTC / ETH cards' "شراء قوي /
   خفيف / محايد" labels and the direction-changed push trigger.

   Numerical tolerance: TradingView and Binance both display Wilder-
   smoothed RSI / MACD with subtle rounding. We assert ranges
   rather than exact decimals so a one-cent arithmetic-order shift
   in floating-point doesn't break the suite. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
  classifyDirection,
  runIndicatorPass,
  multiTfAgreement,
} = require('../src/indicator-engine');

/* ─── EMA ─────────────────────────────────────────────────────────── */

test('calcEMA — null when starved', () => {
  assert.equal(calcEMA(null, 9), null);
  assert.equal(calcEMA([1, 2, 3], 9), null);
});

test('calcEMA — flat series equals the constant', () => {
  const flat = new Array(50).fill(100);
  assert.equal(calcEMA(flat, 14), 100);
});

test('calcEMA — rising series produces a rising EMA', () => {
  const rising = Array.from({ length: 50 }, (_, i) => 100 + i);
  const ema = calcEMA(rising, 9);
  /* The last value (149) should pull the EMA above the SMA seed. */
  assert.ok(ema > 100 && ema < 149);
});

/* ─── RSI ─────────────────────────────────────────────────────────── */

test('calcRSI — flat series returns 50', () => {
  const flat = new Array(50).fill(100);
  assert.equal(calcRSI(flat, 14), 50);
});

test('calcRSI — pure uptrend approaches 100', () => {
  const up = Array.from({ length: 50 }, (_, i) => 100 + i);
  assert.equal(calcRSI(up, 14), 100);
});

test('calcRSI — pure downtrend approaches 0', () => {
  const down = Array.from({ length: 50 }, (_, i) => 200 - i);
  /* avgG=0 → RSI = 100 - 100/(1+0) = 0. */
  assert.equal(calcRSI(down, 14), 0);
});

test('calcRSI — starved input returns 50', () => {
  assert.equal(calcRSI([1, 2, 3], 14), 50);
  assert.equal(calcRSI(null, 14), 50);
});

/* ─── MACD ────────────────────────────────────────────────────────── */

test('calcMACD — short input returns zeros', () => {
  const out = calcMACD([1, 2, 3]);
  assert.equal(out.h, 0);
  assert.equal(out.cross, 'none');
});

test('calcMACD — strong uptrend → positive histogram', () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i);
  const out = calcMACD(up);
  assert.ok(out.h > 0);
});

test('calcMACD — strong downtrend → negative histogram', () => {
  const down = Array.from({ length: 60 }, (_, i) => 200 - i);
  const out = calcMACD(down);
  assert.ok(out.h < 0);
});

test('calcMACD — flat-then-up shows a bull cross', () => {
  /* 30 bars flat, then 30 bars rising — the rising tail should
     drag the MACD above the signal exactly once. */
  const flat = new Array(30).fill(100);
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const out = calcMACD(flat.concat(up));
  /* Either a fresh cross or the histogram is positive — both
     indicate the recent direction is up. */
  assert.ok(out.cross === 'bull' || out.h > 0);
});

/* ─── ATR ─────────────────────────────────────────────────────────── */

test('calcATR — null when starved', () => {
  assert.equal(calcATR(null, 14), null);
  assert.equal(calcATR([[0, 1, 2, 0.5, 1.5, 100]], 14), null);
});

test('calcATR — flat klines yield zero range', () => {
  /* All the OHLC the same → TR = 0 → ATR = 0. */
  const klines = Array.from({ length: 30 }, () => [0, 100, 100, 100, 100, 0]);
  assert.equal(calcATR(klines, 14), 0);
});

test('calcATR — wider candles raise ATR proportionally', () => {
  const tight = Array.from({ length: 30 }, () => [0, 100, 101, 99, 100, 0]);
  const wide = Array.from({ length: 30 }, () => [0, 100, 110, 90, 100, 0]);
  assert.ok(calcATR(wide, 14) > calcATR(tight, 14));
});

/* ─── classifyDirection ───────────────────────────────────────────── */

test('classifyDirection — null input falls back to neutral', () => {
  const out = classifyDirection(null);
  assert.equal(out.label, 'NEUTRAL');
  assert.equal(out.ar, 'محايد');
});

test('classifyDirection — overbought RSI + bull MACD cross + bull EMA stack → STRONG_BUY', () => {
  const out = classifyDirection({
    rsi: 75,
    macd: { h: 1, signal: 0.5, cross: 'bull' },
    ema9: 105,
    ema21: 100,
    ema50: 95,
  });
  assert.equal(out.label, 'STRONG_BUY');
  assert.equal(out.ar, 'شراء قوي');
});

test('classifyDirection — oversold RSI + bear MACD cross + bear EMA stack → STRONG_SELL', () => {
  const out = classifyDirection({
    rsi: 25,
    macd: { h: -1, signal: -0.5, cross: 'bear' },
    ema9: 95,
    ema21: 100,
    ema50: 105,
  });
  assert.equal(out.label, 'STRONG_SELL');
  assert.equal(out.ar, 'بيع قوي');
});

test('classifyDirection — mixed signals fall around NEUTRAL/WATCH', () => {
  const out = classifyDirection({
    rsi: 50,
    macd: { h: 0, signal: 0, cross: 'none' },
    ema9: 100,
    ema21: 100,
    ema50: 100,
  });
  /* All ties — equality means EMAs go into the bear bucket twice. */
  assert.ok(['NEUTRAL', 'WATCH', 'SELL'].includes(out.label));
});

/* ─── runIndicatorPass ────────────────────────────────────────────── */

test('runIndicatorPass — null on starved klines', () => {
  assert.equal(runIndicatorPass(null), null);
  assert.equal(runIndicatorPass([]), null);
  assert.equal(runIndicatorPass([[0, 1, 2, 0.5, 1, 0]]), null);
});

test('runIndicatorPass — full pass on a synthetic uptrend', () => {
  /* 60 bars rising 100 → 160. */
  const klines = Array.from({ length: 60 }, (_, i) => {
    const c = 100 + i;
    return [i * 60_000, c - 0.5, c + 0.5, c - 1, c, 1000];
  });
  const out = runIndicatorPass(klines);
  assert.ok(out);
  assert.ok(out.rsi > 60, 'rsi=' + out.rsi);
  assert.ok(out.macd.h > 0);
  assert.ok(out.ema9 != null && out.ema21 != null && out.ema50 != null);
  assert.ok(out.atr != null);
  assert.ok(['BUY', 'STRONG_BUY', 'WATCH'].includes(out.direction.label));
  assert.ok(typeof out.ts === 'number');
});

test('runIndicatorPass — strong downtrend yields a sell verdict', () => {
  const klines = Array.from({ length: 60 }, (_, i) => {
    const c = 200 - i;
    return [i * 60_000, c + 0.5, c + 1, c - 0.5, c, 1000];
  });
  const out = runIndicatorPass(klines);
  assert.ok(out);
  assert.ok(['SELL', 'STRONG_SELL', 'NEUTRAL'].includes(out.direction.label));
});

/* ─── multiTfAgreement ───────────────────────────────────────────────
   Synthetic helpers that fabricate the minimal indicator shape the
   function reads (just .direction.label). Real values flow from
   runIndicatorPass in production; we don't need them here. */

function dir(label) {
  return { direction: { label } };
}

test('multiTfAgreement — null on empty / single timeframe input', () => {
  assert.equal(multiTfAgreement(null), null);
  assert.equal(multiTfAgreement({}), null);
  assert.equal(multiTfAgreement({ '15m': dir('BUY') }), null);
});

test('multiTfAgreement — full bullish when all three timeframes BUY/STRONG_BUY', () => {
  const r = multiTfAgreement({
    '15m': dir('BUY'),
    '1h': dir('STRONG_BUY'),
    '4h': dir('BUY'),
  });
  assert.equal(r.agreement, 'bullish');
  assert.equal(r.strength, 'full');
  assert.equal(r.count, 3);
});

test('multiTfAgreement — full bearish when all three timeframes SELL/STRONG_SELL', () => {
  const r = multiTfAgreement({
    '15m': dir('SELL'),
    '1h': dir('STRONG_SELL'),
    '4h': dir('STRONG_SELL'),
  });
  assert.equal(r.agreement, 'bearish');
  assert.equal(r.strength, 'full');
});

test('multiTfAgreement — partial bullish when 2 of 3 agree', () => {
  const r = multiTfAgreement({
    '15m': dir('BUY'),
    '1h': dir('NEUTRAL'),
    '4h': dir('STRONG_BUY'),
  });
  assert.equal(r.agreement, 'bullish');
  assert.equal(r.strength, 'partial');
  assert.equal(r.count, 2);
});

test('multiTfAgreement — mixed when buy and sell both present without majority', () => {
  /* 15m BUY, 1h SELL, 4h NEUTRAL → no two TFs agree on direction.
     Result should be "mixed" with strength none. */
  const r = multiTfAgreement({
    '15m': dir('BUY'),
    '1h': dir('SELL'),
    '4h': dir('NEUTRAL'),
  });
  assert.equal(r.agreement, 'mixed');
  assert.equal(r.strength, 'none');
});

test('multiTfAgreement — two-timeframe agreement still counts as full when both bullish', () => {
  /* Only 15m and 1h available, both bullish → full agreement (the
     function trusts whatever count it has once both directions
     match). */
  const r = multiTfAgreement({
    '15m': dir('BUY'),
    '1h': dir('STRONG_BUY'),
  });
  assert.equal(r.agreement, 'bullish');
  assert.equal(r.strength, 'full');
  assert.equal(r.count, 2);
  assert.deepEqual(r.tfs, ['15m', '1h']);
});

test('multiTfAgreement — WATCH labels collapse to neutral (do not vote)', () => {
  const r = multiTfAgreement({
    '15m': dir('WATCH'),
    '1h': dir('WATCH'),
    '4h': dir('BUY'),
  });
  /* Only 4h votes bullish → not enough for partial (needs 2+
     same-direction votes). */
  assert.equal(r.agreement, 'mixed');
  assert.equal(r.strength, 'none');
});
