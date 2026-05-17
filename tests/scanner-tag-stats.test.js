/* Unit tests for src/scanner-tag-stats.js — verifies the
   aggregation correctly partitions evaluated history entries by
   their tag bag and computes the per-tag stats. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTagStats } = require('../src/scanner-tag-stats');

const NOW = 1_730_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function entry(o) {
  /* Default to an evaluated, in-window entry. */
  return Object.assign(
    {
      s: 'BTC',
      score: 105,
      tier: 'ULTRA',
      entryPrice: 100,
      tags: [],
      recordedAt: NOW - 60_000,
      evaluated: true,
      pctChange: 0,
      outcome: 'partial_win',
    },
    o
  );
}

/* ─── Defensive input handling ─────────────────────────────────── */

test('computeTagStats — non-array history returns empty result', () => {
  for (const bad of [null, undefined, {}, 'string', 42]) {
    const out = computeTagStats(bad, { now: NOW });
    assert.equal(out.totalEvaluated, 0);
    assert.deepEqual(out.perTag, {});
  }
});

test('computeTagStats — empty history returns empty result', () => {
  const out = computeTagStats([], { now: NOW });
  assert.equal(out.totalEvaluated, 0);
  assert.equal(out.windowDays, 7);
  assert.equal(typeof out.generatedAt, 'string');
});

/* ─── Window filtering ─────────────────────────────────────────── */

test('computeTagStats — entries older than daysBack are excluded', () => {
  const h = [
    entry({ s: 'BTC', recordedAt: NOW - 1 * ONE_DAY, tags: ['🚀A'], outcome: 'win', pctChange: 8 }),
    entry({
      s: 'OLD',
      recordedAt: NOW - 30 * ONE_DAY,
      tags: ['🚀A'],
      outcome: 'win',
      pctChange: 8,
    }),
  ];
  const out = computeTagStats(h, { now: NOW, daysBack: 7, minSamples: 1 });
  assert.equal(out.totalEvaluated, 1);
  assert.equal(out.perTag['🚀A'].count, 1);
});

test('computeTagStats — non-evaluated entries are excluded', () => {
  const h = [
    entry({ tags: ['A'], evaluated: false, outcome: undefined }),
    entry({ tags: ['A'], evaluated: true, outcome: 'win', pctChange: 6 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.equal(out.totalEvaluated, 1);
});

/* ─── Pre-P1.0b entries (no tags field) ────────────────────────── */

test('computeTagStats — entries without tags are counted in totalWithoutTags', () => {
  const h = [
    entry({ s: 'A', tags: ['X'], outcome: 'win', pctChange: 6 }),
    entry({ s: 'B', tags: undefined, outcome: 'win', pctChange: 6 }) /* pre-extension */,
    entry({ s: 'C', tags: [], outcome: 'win', pctChange: 6 }) /* empty bag */,
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.equal(out.totalEvaluated, 1, 'only entry A has usable tags');
  assert.equal(out.totalWithoutTags, 2, 'both undefined and empty count as without-tags');
});

/* ─── minSamples cutoff ────────────────────────────────────────── */

test('computeTagStats — tags below minSamples are dropped', () => {
  const h = [
    entry({ s: 'A', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'B', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'C', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'D', tags: ['RARE'], outcome: 'win', pctChange: 5 }) /* single fire */,
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 3 });
  assert.ok('POPULAR' in out.perTag);
  assert.ok(!('RARE' in out.perTag), 'tag with count < minSamples must be omitted');
});

test('computeTagStats — minSamples: 1 keeps every tag', () => {
  const h = [entry({ tags: ['RARE'], outcome: 'win', pctChange: 5 })];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.equal(out.perTag.RARE.count, 1);
});

/* ─── Per-tag aggregation ──────────────────────────────────────── */

test('computeTagStats — counts, wins/losses, winRate are correct', () => {
  const h = [
    entry({ s: 'A', tags: ['WHALE'], outcome: 'win', pctChange: 8 }),
    entry({ s: 'B', tags: ['WHALE'], outcome: 'win', pctChange: 6 }),
    entry({ s: 'C', tags: ['WHALE'], outcome: 'loss', pctChange: -5 }),
    entry({ s: 'D', tags: ['WHALE'], outcome: 'partial_win', pctChange: 2 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  const stats = out.perTag.WHALE;
  assert.equal(stats.count, 4);
  assert.equal(stats.wins, 2);
  assert.equal(stats.losses, 1);
  assert.equal(stats.winRate, 50, '2 wins out of 4 = 50%');
});

test('computeTagStats — avgGain averages pctChange', () => {
  const h = [
    entry({ s: 'A', tags: ['T'], outcome: 'win', pctChange: 10 }),
    entry({ s: 'B', tags: ['T'], outcome: 'loss', pctChange: -4 }),
    entry({ s: 'C', tags: ['T'], outcome: 'partial_win', pctChange: 3 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.equal(out.perTag.T.avgGain, 3, 'mean of [10, -4, 3] = 3');
});

test('computeTagStats — bestSignal and worstSignal carry symbol + pct', () => {
  const h = [
    entry({ s: 'BIG', tags: ['T'], outcome: 'win', pctChange: 25 }),
    entry({ s: 'MID', tags: ['T'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'SMALL', tags: ['T'], outcome: 'loss', pctChange: -8 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.deepEqual(out.perTag.T.bestSignal, { s: 'BIG', pctChange: 25 });
  assert.deepEqual(out.perTag.T.worstSignal, { s: 'SMALL', pctChange: -8 });
});

test('computeTagStats — entry with multiple tags contributes to each bucket', () => {
  const h = [
    entry({ s: 'X', tags: ['A', 'B', 'C'], outcome: 'win', pctChange: 7 }),
    entry({ s: 'Y', tags: ['A', 'B'], outcome: 'loss', pctChange: -4 }),
    entry({ s: 'Z', tags: ['A'], outcome: 'win', pctChange: 5 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.equal(out.perTag.A.count, 3, 'all three carry A');
  assert.equal(out.perTag.B.count, 2, 'X and Y carry B');
  assert.equal(out.perTag.C.count, 1, 'only X carries C');
});

test('computeTagStats — non-string tags inside the array are skipped', () => {
  const h = [
    entry({ tags: ['REAL', 42, null, '', { obj: true }], outcome: 'win', pctChange: 6 }),
    entry({ tags: ['REAL'], outcome: 'win', pctChange: 6 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  assert.equal(out.perTag.REAL.count, 2);
  assert.equal(Object.keys(out.perTag).length, 1, 'only the string tag should appear');
});

/* ─── Output shape & ordering ──────────────────────────────────── */

test('computeTagStats — tags are sorted by count desc in iteration order', () => {
  const h = [
    entry({ s: 'A', tags: ['RARE'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'B', tags: ['RARE'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'C', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'D', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'E', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
    entry({ s: 'F', tags: ['POPULAR'], outcome: 'win', pctChange: 5 }),
  ];
  const out = computeTagStats(h, { now: NOW, minSamples: 1 });
  /* Object property iteration order in ES2015+ follows insertion
     order for string keys, so the sort takes effect. */
  const keys = Object.keys(out.perTag);
  assert.equal(keys[0], 'POPULAR');
  assert.equal(keys[1], 'RARE');
});

test('computeTagStats — generatedAt is an ISO timestamp', () => {
  const out = computeTagStats([], { now: NOW });
  assert.match(out.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('computeTagStats — windowDays defaults to 7', () => {
  const out = computeTagStats([], { now: NOW });
  assert.equal(out.windowDays, 7);
});
