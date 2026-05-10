/* Unit tests for src/whale-engine.js — folds the data_server.py
   whale stream into per-symbol waves + engine rank, drives the
   wave-detected push trigger. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aggregateWhales,
  pickRankedWaves,
  WAVE_WINDOW_MS,
  TIER_A_BUY,
  TIER_B_BUY,
  TIER_C_BUY,
} = require('../src/whale-engine');

const NOW = 1_700_000_000_000;

function w(sym, side, value, offsetMs) {
  return { sym, side, value, price: 100, time: NOW - (offsetMs || 0) };
}

test('aggregateWhales — returns empty map on bad input', () => {
  assert.deepEqual(aggregateWhales(null, { now: NOW }), {});
  assert.deepEqual(aggregateWhales([], { now: NOW }), {});
  assert.deepEqual(aggregateWhales([{ no: 'sym' }], { now: NOW }), {});
});

test('aggregateWhales — drops rows older than the window', () => {
  const stale = w('BTC', 'buy', TIER_A_BUY, WAVE_WINDOW_MS + 1000);
  const out = aggregateWhales([stale], { now: NOW });
  assert.deepEqual(out, {});
});

test('aggregateWhales — drops noise below the significance floor', () => {
  const out = aggregateWhales([w('BTC', 'buy', 1000, 0)], { now: NOW });
  assert.deepEqual(out, {});
});

test('aggregateWhales — Tier A: heavy buy + high ratio', () => {
  const buys = [w('BTC', 'buy', 600_000, 100), w('BTC', 'buy', 500_000, 50)];
  const out = aggregateWhales(buys, { now: NOW });
  assert.equal(out.BTC.engine.rank, 'A');
  assert.equal(out.BTC.engine.confidence, 90);
  assert.equal(out.BTC.totalBuy, 1_100_000);
  assert.equal(out.BTC.engine.buyRatio, 100);
});

test('aggregateWhales — Tier B: moderate buy + 60% ratio', () => {
  const rows = [w('BTC', 'buy', 600_000, 50), w('BTC', 'sell', 400_000, 30)];
  const out = aggregateWhales(rows, { now: NOW });
  assert.equal(out.BTC.engine.rank, 'B');
  assert.equal(out.BTC.engine.confidence, 70);
});

test('aggregateWhales — Tier C: light buy + just-over-half ratio', () => {
  const rows = [w('BTC', 'buy', 250_000, 50), w('BTC', 'sell', 200_000, 30)];
  const out = aggregateWhales(rows, { now: NOW });
  assert.equal(out.BTC.engine.rank, 'C');
});

test('aggregateWhales — Tier D: heavy distribution gets flagged', () => {
  const rows = [w('BTC', 'sell', 600_000, 50), w('BTC', 'buy', 100_000, 30)];
  const out = aggregateWhales(rows, { now: NOW });
  assert.equal(out.BTC.engine.rank, 'D');
});

test('aggregateWhales — buyRatio is a percent with 1 decimal', () => {
  const rows = [w('BTC', 'buy', 700_000, 50), w('BTC', 'sell', 300_000, 30)];
  const out = aggregateWhales(rows, { now: NOW });
  assert.equal(out.BTC.engine.buyRatio, 70);
});

test('aggregateWhales — splits by symbol', () => {
  const rows = [
    w('BTC', 'buy', 1_500_000, 100),
    w('ETH', 'buy', 600_000, 80),
    w('ETH', 'buy', 600_000, 60),
    w('SOL', 'sell', 50_000, 30),
  ];
  const out = aggregateWhales(rows, { now: NOW });
  assert.equal(Object.keys(out).length, 3);
  assert.equal(out.BTC.engine.rank, 'A');
  assert.equal(out.ETH.engine.rank, 'A');
  assert.ok(['—', 'C'].includes(out.SOL.engine.rank));
});

test('aggregateWhales — waves array is newest-first and capped', () => {
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push(w('BTC', 'buy', 30_000, i * 1000));
  const out = aggregateWhales(rows, { now: NOW });
  assert.ok(out.BTC.waves.length <= 30);
  /* Newest first — descending time. */
  for (let i = 1; i < out.BTC.waves.length; i++) {
    assert.ok(out.BTC.waves[i - 1].time >= out.BTC.waves[i].time);
  }
});

test('aggregateWhales — returns empty map when whales below TIER_C', () => {
  /* 100K is above the noise floor (25K) but below TIER_C_BUY (200K) so
     no rank is assigned — verifying the rank-tier ladder, not the
     filter. */
  const out = aggregateWhales([w('BTC', 'buy', 100_000, 50)], { now: NOW });
  assert.equal(out.BTC.engine.rank, '—');
  assert.equal(out.BTC.engine.confidence, 0);
});

/* ─── pickRankedWaves ──────────────────────────────────────────── */

test('pickRankedWaves — sorts by confidence then totalBuy', () => {
  const map = {
    AAA: { sym: 'AAA', engine: { confidence: 90, totalBuy: 5_000_000 }, totalBuy: 5_000_000 },
    BBB: { sym: 'BBB', engine: { confidence: 90, totalBuy: 8_000_000 }, totalBuy: 8_000_000 },
    CCC: { sym: 'CCC', engine: { confidence: 70, totalBuy: 99_000_000 }, totalBuy: 99_000_000 },
  };
  const ranked = pickRankedWaves(map);
  assert.equal(ranked[0].sym, 'BBB');
  assert.equal(ranked[1].sym, 'AAA');
  assert.equal(ranked[2].sym, 'CCC');
});

test('pickRankedWaves — limit caps the result', () => {
  const map = {
    A: { sym: 'A', engine: { confidence: 50 }, totalBuy: 1 },
    B: { sym: 'B', engine: { confidence: 50 }, totalBuy: 1 },
    C: { sym: 'C', engine: { confidence: 50 }, totalBuy: 1 },
  };
  assert.equal(pickRankedWaves(map, 2).length, 2);
});

test('pickRankedWaves — empty input', () => {
  assert.deepEqual(pickRankedWaves({}), []);
  assert.deepEqual(pickRankedWaves(null), []);
});

/* sanity: thresholds are sane — Tier A heavier than B heavier than C. */
test('thresholds form a strict descending ladder', () => {
  assert.ok(TIER_A_BUY > TIER_B_BUY);
  assert.ok(TIER_B_BUY > TIER_C_BUY);
});
