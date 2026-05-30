/* Unit tests for src/market-aggregate.js — the pure data-layer core:
   multi-venue funding/OI aggregation, cross-venue agreement, soft
   confidence (D5), source completeness, and snapshot assembly. */

const test = require('node:test');
const assert = require('node:assert/strict');

const agg = require('../src/market-aggregate');

function approx(a, b, eps) {
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), `expected ${a} ≈ ${b}`);
}

test('computeAgreement — tight same-sign values agree, mixed signs do not', () => {
  assert.equal(agg.computeAgreement([0.00005, 0.00004, 0.000048]), 0.95);
  assert.equal(agg.computeAgreement([0.00005, -0.00008]), 0.25);
  assert.equal(agg.computeAgreement([5]), 1); // nothing to disagree with
  assert.equal(agg.computeAgreement([]), 0);
  assert.equal(agg.computeAgreement([3, 3]), 1); // identical
});

test('aggregateFunding — equal-weight mean + annualized %, scalar or object form', () => {
  const f = agg.aggregateFunding({ binance: 0.00005, bybit: 0.00004, okex: 0.000048 });
  approx(f.value, 0.000046);
  assert.equal(f.venues, 3);
  assert.equal(f.agreement, 0.95);
  assert.equal(f.annualizedPct, 5.04); // 0.000046 * 1095 * 100
  assert.deepEqual(Object.keys(f.perVenue).sort(), ['binance', 'bybit', 'okex']);
  assert.equal(agg.aggregateFunding({}), null);
});

test('aggregateFunding — volume-weighted when every venue carries a weight', () => {
  const f = agg.aggregateFunding({
    binance: { rate: 0.00006, weight: 2 },
    bybit: { rate: 0.00004, weight: 1 },
  });
  approx(f.value, 0.00016 / 3); // (0.00006*2 + 0.00004*1) / 3
});

test('aggregateOI — sums notional across venues', () => {
  const oi = agg.aggregateOI({ binance: 7.7e9, bybit: 3e9 });
  approx(oi.valueUsd, 1.07e10);
  assert.equal(oi.venues, 2);
  assert.equal(agg.aggregateOI({}), null);
});

test('confidenceFor — liveness × staleness × agreement (soft, D5)', () => {
  assert.equal(
    agg.confidenceFor({ liveVenues: 3, totalVenues: 3, agreement: 0.95, ageMs: 0, ttlMs: 300000 }),
    0.98
  );
  assert.equal(
    agg.confidenceFor({ liveVenues: 1, totalVenues: 3, agreement: 1, ageMs: 0, ttlMs: 300000 }),
    0.33
  ); // 1 of 3 venues → weaker, not dropped
  assert.equal(
    agg.confidenceFor({
      liveVenues: 3,
      totalVenues: 3,
      agreement: 1,
      ageMs: 300000,
      ttlMs: 300000,
    }),
    0.5
  ); // one TTL old → halved
  assert.equal(
    agg.confidenceFor({
      liveVenues: 3,
      totalVenues: 3,
      agreement: 1,
      ageMs: 600000,
      ttlMs: 300000,
    }),
    0
  ); // two TTLs → zero
  assert.equal(agg.confidenceFor({ live: 1, ageMs: 0, ttlMs: 180000 }), 1); // single-source, fresh
});

test('sourceCompleteness — completeness fraction + degraded list', () => {
  const h = agg.sourceCompleteness({ a: { ok: true }, b: { ok: false }, c: { ok: true } });
  assert.equal(h.sourcesTotal, 3);
  assert.equal(h.sourcesLive, 2);
  assert.equal(h.completeness, 0.67);
  assert.deepEqual(h.degraded, ['b']);
  assert.equal(agg.sourceCompleteness({}).completeness, 0);
});

test('buildSnapshot — assembles signals with confidence; omits absent; defers options', () => {
  const now = Date.UTC(2026, 4, 30, 12, 0, 0);
  const snap = agg.buildSnapshot({
    sym: 'BTC',
    now,
    price: 73880,
    priceTs: now,
    funding: { binance: 0.00005, bybit: 0.00004, okex: 0.000048 },
    fundingTs: now,
    oi: { binance: 7.7e9, bybit: 3e9 },
    oiTs: now,
    news: { label: 'negative', score: 38 },
    newsTs: now,
    perSource: { binance: { ok: true }, bybit: { ok: true }, okex: { ok: false } },
  });
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.sym, 'BTC');
  assert.equal(snap.asOf, now);
  assert.equal(snap.price.value, 73880);
  approx(snap.signals.funding.value, 0.000046);
  assert.ok(snap.signals.funding.confidence > 0 && snap.signals.funding.confidence <= 1);
  approx(snap.signals.openInterest.valueUsd, 1.07e10);
  assert.equal(snap.signals.news.label, 'negative');
  assert.equal(snap.signals.options.available, false);
  assert.equal(snap.health.completeness, 0.67);
  assert.ok(!/undefined|NaN/.test(JSON.stringify(snap)));
});

test('buildSnapshot — absent signals are omitted, not faked', () => {
  const snap = agg.buildSnapshot({ sym: 'ETH', now: 1, price: 2000 });
  assert.equal(snap.signals.funding, undefined);
  assert.equal(snap.signals.openInterest, undefined);
  assert.equal(snap.signals.news, undefined);
  assert.equal(snap.signals.options.available, false);
});
