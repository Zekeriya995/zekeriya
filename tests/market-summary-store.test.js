/* Unit tests for src/market-summary-store.js — the server-side monitor /
   store. Pure orchestration is exercised on in-memory state with fixed
   timestamps; the disk wrapper is covered via its crash-tolerant fallback
   (a missing file returns empty state) without writing anything. */

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/market-summary-store');

const HOUR = 3600000;
const BASE = Date.UTC(2026, 4, 30, 8, 0, 0);

test('momentumTs — symmetric 1h price-momentum buckets', () => {
  const s = [{ t: BASE - 2 * HOUR, price: 100 }];
  const now = BASE;
  assert.equal(store.momentumTs(s, 101.5, now), 4); // +1.5%
  assert.equal(store.momentumTs(s, 100.5, now), 2); // +0.5%
  assert.equal(store.momentumTs(s, 99.7, now), 0); // -0.3% (dead band)
  assert.equal(store.momentumTs(s, 99.5, now), -2); // -0.5%
  assert.equal(store.momentumTs(s, 99, now), -4); // -1.0%
  assert.equal(store.momentumTs([], 100, now), 0); // no reference
});

test('buildSample — OI change vs prev, completeness, momentum ts', () => {
  const series = [{ t: BASE - HOUR, price: 100, oi: 1000 }];
  const md = {
    price: 102,
    oi: 1100,
    funding: 0.0005,
    newsTone: 'negative',
    sourcesLive: 9,
    sourcesTotal: 12,
  };
  const s = store.buildSample(series, md, BASE);
  assert.equal(s.price, 102);
  assert.equal(s.ts, 4); // +2% over 1h
  assert.ok(Math.abs(s.oiChangePct - 10) < 1e-9); // 1000 -> 1100
  assert.equal(s.funding, 0.0005);
  assert.equal(s.newsTone, 'negative');
  assert.ok(Math.abs(s.completeness - 0.75) < 1e-9);
});

test('buildSample — no history: no OI change, neutral ts, null completeness', () => {
  const s = store.buildSample([], { price: 100 }, BASE);
  assert.equal(s.oiChangePct, null);
  assert.equal(s.ts, 0);
  assert.equal(s.completeness, null);
});

test('recordSample — throttle and cap', () => {
  const state = store.emptyState();
  const md = { price: 100, oi: 1000, sourcesLive: 6, sourcesTotal: 12 };
  assert.equal(store.recordSample(state, 'BTC', md, BASE).recorded, true);
  assert.equal(store.recordSample(state, 'BTC', md, BASE + 60000).recorded, false); // <10 min
  assert.equal(store.recordSample(state, 'BTC', md, BASE + 11 * 60000).recorded, true);
  assert.equal(state.series.BTC.length, 2);

  const big = store.emptyState();
  big.series.BTC = [];
  for (let i = 0; i < store.MAX_SAMPLES; i++)
    big.series.BTC.push({ t: BASE - (300 - i) * 60000, price: 100 });
  store.recordSample(big, 'BTC', md, BASE + 60 * 60000);
  assert.equal(big.series.BTC.length, store.MAX_SAMPLES); // capped
});

test('regenerate — stores AR + EN, direction, and windows out old samples', () => {
  const state = store.emptyState();
  state.series.BTC = [
    { t: BASE - 30 * HOUR, price: 1, ts: 0 }, // outside 24h window — excluded
    { t: BASE - 6 * HOUR, price: 74000, ts: 2 },
    { t: BASE - 3 * HOUR, price: 73000, ts: -2 },
    { t: BASE, price: 73500, ts: 0, oiChangePct: -1.7, newsTone: 'negative', completeness: 0.75 },
  ];
  const sm = store.regenerate(state, 'BTC', BASE);
  assert.equal(sm.samples, 3); // the 30h-old sample is excluded
  assert.equal(sm.dir, 'neutral'); // latest ts = 0
  assert.ok(sm.ar.text.includes('البيتكوين'));
  assert.match(sm.en.text, /BTC/);
  assert.equal(sm.enough, true);
  assert.ok(!/undefined|NaN/.test(sm.ar.text));
});

test('shouldRegenerate — never / interval / flip / otherwise', () => {
  const state = store.emptyState();
  assert.equal(store.shouldRegenerate(state, 'BTC', BASE), true); // never generated

  state.series.BTC = [{ t: BASE, price: 100, ts: 2 }]; // bucket = bull
  state.summary.BTC = { dir: 'bull', at: BASE };
  assert.equal(store.shouldRegenerate(state, 'BTC', BASE + 60000), false); // fresh, no flip

  assert.equal(store.shouldRegenerate(state, 'BTC', BASE + 7 * HOUR), true); // interval elapsed

  state.series.BTC = [{ t: BASE, price: 100, ts: -2 }]; // bucket now bear → flip vs stored 'bull'
  assert.equal(store.shouldRegenerate(state, 'BTC', BASE + 60000), true);
});

test('tick — records, regenerates, signals change, and is throttle-stable', () => {
  const state = store.emptyState();
  const md = {
    BTC: { price: 100, oi: 1000, sourcesLive: 6, sourcesTotal: 12 },
    ETH: { price: 2000, oi: 500, sourcesLive: 6, sourcesTotal: 12 },
  };
  assert.equal(store.tick(state, md, BASE), true); // first tick: records + regenerates
  assert.equal(state.series.BTC.length, 1);
  assert.ok(state.summary.BTC && state.summary.ETH);

  // immediate re-tick: sample throttled, summary fresh, no flip → no change
  assert.equal(store.tick(state, md, BASE + 60000), false);

  // 11 min later, BTC up >1% over the hour drives a flip to strong_bull → change
  const md2 = { BTC: { price: 102, oi: 1000, sourcesLive: 6, sourcesTotal: 12 } };
  assert.equal(store.tick(state, md2, BASE + 11 * 60000), true);
  assert.equal(state.series.BTC.length, 2);
});

test('load — tolerates a missing / unreadable store and returns empty state', () => {
  const s = store.load();
  assert.equal(typeof s, 'object');
  assert.equal(typeof s.series, 'object');
  assert.equal(typeof s.summary, 'object');
});
