/* Unit tests for src/microstructure.js — iceberg detection with the
   relative price band (audit Group D). The headline test is that a real
   cluster at BTC's ~$74k price is DETECTED — the old absolute-0.0001
   bucket would have split those fills across buckets and missed it. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectIceberg } = require('../src/microstructure');

const T0 = 1_780_000_000_000;
function trade(p, v, buy, tOff) {
  return { p, v, buy, t: T0 + tOff };
}
/* `count` buy/sell fills clustered within ~$`spread` of `base`, uniform v. */
function cluster(base, spread, count, buy, v) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(trade(base + (spread * i) / (count - 1), v == null ? 1 : v, buy, i * 1000));
  }
  return out;
}

test('detectIceberg — catches a real cluster at BTC ~$74k (Group D fix)', () => {
  /* 10 fills within ~$20 of $74,000 — comfortably inside the 0.05% (~$37)
     band, but each a distinct price the old absolute bucket would isolate. */
  const r = detectIceberg(cluster(74000, 8, 10, true), { curP: 74000 });
  assert.equal(r.signal, 'ICEBERG_BUY');
  assert.equal(r.count, 1);
  assert.equal(r.icebergs[0].count, 10);
  assert.equal(r.icebergs[0].uniform, true);
  assert.equal(r.score, 12);
});

test('detectIceberg — scale-free: the same pattern at $0.50 is also caught', () => {
  const r = detectIceberg(cluster(0.5, 0.0001, 10, true), { curP: 0.5 });
  assert.equal(r.signal, 'ICEBERG_BUY');
  assert.equal(r.count, 1);
});

test('detectIceberg — sell-dominant cluster reads ICEBERG_SELL', () => {
  const r = detectIceberg(cluster(74000, 8, 10, false), { curP: 74000 });
  assert.equal(r.signal, 'ICEBERG_SELL');
});

test('detectIceberg — too few trades overall → NO_ICEBERG', () => {
  const r = detectIceberg(cluster(74000, 10, 5, true), { curP: 74000 });
  assert.equal(r.signal, 'NO_ICEBERG');
  assert.equal(r.count, 0);
});

test('detectIceberg — fills spread beyond the band do not form a level', () => {
  /* 12 trades $40 apart → each lands in its own ~$37 band → no level ≥8. */
  const trades = [];
  for (let i = 0; i < 12; i++) trades.push(trade(74000 + i * 40, 1, true, i * 1000));
  const r = detectIceberg(trades, { curP: 74000 });
  assert.equal(r.signal, 'NO_ICEBERG');
});

test('detectIceberg — non-uniform fill sizes score lower (6, not 12)', () => {
  const trades = cluster(74000, 8, 10, true, 1);
  trades[9].v = 200; // one huge fill → high size variance → not uniform
  const r = detectIceberg(trades, { curP: 74000 });
  assert.equal(r.count, 1);
  assert.equal(r.icebergs[0].uniform, false);
  assert.equal(r.score, 6);
});

test('detectIceberg — a cluster spread beyond the 120s window is ignored', () => {
  const trades = [];
  for (let i = 0; i < 10; i++) trades.push(trade(74000 + i, 1, true, i * 20000)); // 0..180s
  const r = detectIceberg(trades, { curP: 74000 });
  assert.equal(r.signal, 'NO_ICEBERG');
});

test('detectIceberg — falls back to the last trade price when curP is absent', () => {
  const r = detectIceberg(cluster(74000, 20, 10, true));
  assert.equal(r.signal, 'ICEBERG_BUY');
});
