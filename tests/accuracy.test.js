/* Unit tests for src/accuracy.js — the direction accuracy loop (audit A,
   decision D2). The headline test runs a hand-computed hourly series
   through the 4h horizon and checks the exact correct/evaluated counts. */

const test = require('node:test');
const assert = require('node:assert/strict');

const acc = require('../src/accuracy');

const H = 3600000;
const T0 = Date.UTC(2026, 4, 30, 0, 0, 0);
function s(hour, price, ts) {
  return { t: T0 + hour * H, price, ts };
}

test('directionGroup — ts → bull / bear / neutral', () => {
  assert.equal(acc.directionGroup(4), 'bull');
  assert.equal(acc.directionGroup(2), 'bull');
  assert.equal(acc.directionGroup(1), 'neutral');
  assert.equal(acc.directionGroup(0), 'neutral');
  assert.equal(acc.directionGroup(-2), 'bear');
  assert.equal(acc.directionGroup(-4), 'bear');
});

test('isCorrect — bull/bear need a move past the dead-band; neutral needs to stay inside it', () => {
  assert.equal(acc.isCorrect('bull', 1.0, 0.5), true);
  assert.equal(acc.isCorrect('bull', 0.3, 0.5), false);
  assert.equal(acc.isCorrect('bear', -1.0, 0.5), true);
  assert.equal(acc.isCorrect('bear', -0.3, 0.5), false);
  assert.equal(acc.isCorrect('neutral', 0.2, 0.5), true);
  assert.equal(acc.isCorrect('neutral', 0.9, 0.5), false);
});

/* Hourly series; under the 4h horizon, five calls become evaluable:
   s0 bull→+3% ✓, s1 bear→−3% ✓, s2 neutral→+0.2% ✓, s3 bull→0% ✗,
   s4 bull→+2.9% ✓  → 4/5 = 80%. */
const SERIES = [
  s(0, 100, 2),
  s(1, 100, -2),
  s(2, 100, 0),
  s(3, 100, 2),
  s(4, 103, 2),
  s(5, 97, 0),
  s(6, 100.2, 0),
  s(7, 100, 0),
  s(8, 106, 0),
];

test('evaluateAccuracy — 4h horizon, exact correct/evaluated counts', () => {
  const r = acc.evaluateAccuracy(SERIES, { horizonsMs: { '4h': 4 * H }, minSamples: 1 });
  assert.equal(r.byHorizon['4h'].evaluated, 5);
  assert.equal(r.byHorizon['4h'].correct, 4);
  assert.equal(r.byHorizon['4h'].pct, 80);
  assert.equal(r.primary, '4h'); // only horizon present
  assert.equal(r.pct, 80);
});

test('evaluateAccuracy — a horizon with no elapsed future is not evaluated', () => {
  const r = acc.evaluateAccuracy(SERIES, { horizonsMs: { '24h': 24 * H }, minSamples: 1 });
  assert.equal(r.byHorizon['24h'].evaluated, 0);
  assert.equal(r.byHorizon['24h'].pct, null);
});

test('evaluateAccuracy — below minSamples reports null (still accumulating)', () => {
  const r = acc.evaluateAccuracy(SERIES, { horizonsMs: { '4h': 4 * H }, minSamples: 10 });
  assert.equal(r.byHorizon['4h'].evaluated, 5);
  assert.equal(r.byHorizon['4h'].pct, null); // 5 < 10
});

test('evaluateAccuracy — empty / tiny series is graceful', () => {
  const r = acc.evaluateAccuracy([], {});
  assert.equal(r.pct, null);
  assert.equal(r.evaluated, 0);
  assert.ok(r.byHorizon['4h'] && r.byHorizon['24h']); // default horizons present
});
