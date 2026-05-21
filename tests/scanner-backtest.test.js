/* Unit tests for src/scanner-backtest.js — the Phase 4 backtest
   harness. Pins the per-rule attribution math against synthetic
   histories so the contract holds even if a future PR re-shapes
   the registry or the history entry. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeRuleAttribution,
  computeBacktestSummary,
  MIN_DEFAULT_SAMPLES,
  DEFAULT_DAYS_BACK,
} = require('../src/scanner-backtest');

/* ─── Helpers ───────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const DAY_MS = 86_400_000;

/* Synthetic rules registry — small but representative. Mix of
   tagged and tagless (the tagless rule must be SKIPPED by the
   attribution helper). */
const RULES = Object.freeze([
  Object.freeze({ id: 'GOOD_RULE', weight: 20, tag: '🟢GOOD', condition: () => true }),
  Object.freeze({ id: 'BAD_RULE', weight: 15, tag: '🔴BAD', condition: () => true }),
  Object.freeze({ id: 'NEUTRAL_RULE', weight: 5, tag: '🟡NEU', condition: () => true }),
  /* Tagless rule — attribution must SKIP this (can't tell from
     history whether it fired). */
  Object.freeze({ id: 'TAGLESS_PENALTY', weight: -10, tag: null, condition: () => true }),
]);

function makeEntry({
  s = 'BTC',
  tier = 'ULTRA',
  pctChange = 6,
  outcome = 'win',
  tags = [],
  recordedAtDaysAgo = 1,
  evaluated = true,
} = {}) {
  return {
    s,
    tier,
    entryPrice: 100,
    exitPrice: 100 + pctChange,
    pctChange,
    outcome,
    tags,
    recordedAt: NOW - recordedAtDaysAgo * DAY_MS,
    evaluatedAt: NOW - (recordedAtDaysAgo - 1) * DAY_MS,
    evaluated,
  };
}

/* ─── Shape + edge cases ─────────────────────────────────────── */

test('empty history → empty result with zero totals', () => {
  const out = computeRuleAttribution([], RULES, { now: NOW });
  assert.equal(out.totalEvaluated, 0);
  assert.deepEqual(out.perRule, {});
  assert.deepEqual(out.byTier, {});
  assert.deepEqual(out.topPositiveDelta, []);
  assert.deepEqual(out.topNegativeDelta, []);
  assert.deepEqual(out.suspiciousRules, []);
});

test('null / missing history is tolerated', () => {
  assert.equal(computeRuleAttribution(null, RULES, { now: NOW }).totalEvaluated, 0);
  assert.equal(computeRuleAttribution(undefined, RULES, { now: NOW }).totalEvaluated, 0);
});

test('null / missing rules is tolerated', () => {
  const hist = [makeEntry({ tags: ['🟢GOOD'] })];
  const out = computeRuleAttribution(hist, null, { now: NOW });
  assert.equal(out.totalEvaluated, 0);
  assert.deepEqual(out.perRule, {});
});

test('unevaluated entries are filtered out', () => {
  const hist = [
    makeEntry({ tags: ['🟢GOOD'], evaluated: false }),
    makeEntry({ tags: ['🟢GOOD'], evaluated: false, outcome: undefined }),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW });
  assert.equal(out.totalEvaluated, 0);
});

test('entries outside the daysBack window are filtered out', () => {
  const hist = [
    makeEntry({ tags: ['🟢GOOD'], recordedAtDaysAgo: 35 }) /* outside default 30-day window */,
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW, daysBack: 30 });
  assert.equal(out.totalEvaluated, 0);
});

/* ─── Per-rule attribution math ──────────────────────────────── */

test('rule with all-winning fires + losing-absents shows positive delta', () => {
  const hist = [
    /* Fired group (GOOD tag present) — all wins, +8% avg */
    makeEntry({ tags: ['🟢GOOD'], pctChange: 8, outcome: 'win' }),
    makeEntry({ tags: ['🟢GOOD'], pctChange: 8, outcome: 'win' }),
    makeEntry({ tags: ['🟢GOOD'], pctChange: 8, outcome: 'win' }),
    makeEntry({ tags: ['🟢GOOD'], pctChange: 8, outcome: 'win' }),
    makeEntry({ tags: ['🟢GOOD'], pctChange: 8, outcome: 'win' }),
    /* Absent group (no GOOD tag) — all losses, -4% avg */
    makeEntry({ tags: ['🟡NEU'], pctChange: -4, outcome: 'loss' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: -4, outcome: 'loss' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: -4, outcome: 'loss' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: -4, outcome: 'loss' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: -4, outcome: 'loss' }),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW });
  const good = out.perRule.GOOD_RULE;
  assert.equal(good.fired, 5);
  assert.equal(good.absent, 5);
  assert.equal(good.firedWinRate, 100);
  assert.equal(good.absentWinRate, 0);
  assert.equal(good.firedAvgGain, 8);
  assert.equal(good.absentAvgGain, -4);
  assert.equal(good.delta, 12);
  assert.equal(good.sampleSize, 'sufficient');
  /* GOOD_RULE should appear in the topPositiveDelta list */
  assert.ok(out.topPositiveDelta.includes('GOOD_RULE'));
  /* Not suspicious (positive delta, positive weight) */
  assert.ok(!out.suspiciousRules.includes('GOOD_RULE'));
});

test('suspicious rule detection — positive-weight rule with NEGATIVE delta', () => {
  /* BAD_RULE has weight +15 but signals carrying its tag do
     WORSE than signals without it. This is the worst kind of
     bug — the score formula is being pulled the wrong way by
     its own weights. Surfacing this is the whole point of
     Phase 4. */
  const hist = [
    /* Fired group (BAD tag) — all losses, -5% avg */
    makeEntry({ tags: ['🔴BAD'], pctChange: -5, outcome: 'loss' }),
    makeEntry({ tags: ['🔴BAD'], pctChange: -5, outcome: 'loss' }),
    makeEntry({ tags: ['🔴BAD'], pctChange: -5, outcome: 'loss' }),
    makeEntry({ tags: ['🔴BAD'], pctChange: -5, outcome: 'loss' }),
    makeEntry({ tags: ['🔴BAD'], pctChange: -5, outcome: 'loss' }),
    /* Absent group (no BAD) — all wins, +6% avg */
    makeEntry({ tags: ['🟡NEU'], pctChange: 6, outcome: 'win' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: 6, outcome: 'win' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: 6, outcome: 'win' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: 6, outcome: 'win' }),
    makeEntry({ tags: ['🟡NEU'], pctChange: 6, outcome: 'win' }),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW });
  const bad = out.perRule.BAD_RULE;
  assert.equal(bad.delta, -11);
  assert.ok(out.suspiciousRules.includes('BAD_RULE'));
  assert.ok(out.topNegativeDelta.includes('BAD_RULE'));
});

test('tagless rules are SKIPPED in attribution (no tag to grep)', () => {
  const hist = [
    makeEntry({ tags: ['🟢GOOD'], pctChange: 8 }),
    makeEntry({ tags: ['🟡NEU'], pctChange: -2, outcome: 'partial_loss' }),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW });
  /* TAGLESS_PENALTY must not appear in perRule. */
  assert.ok(!('TAGLESS_PENALTY' in out.perRule));
});

test('low-sample rules are kept in perRule but excluded from rankings', () => {
  const hist = [
    /* Only ONE GOOD-tagged entry, below the default 5 minSamples */
    makeEntry({ tags: ['🟢GOOD'], pctChange: 10 }),
    /* Many NEU-tagged entries — enough samples but no GOOD */
    ...Array(10)
      .fill(0)
      .map(() => makeEntry({ tags: ['🟡NEU'], pctChange: 1 })),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW });
  assert.equal(out.perRule.GOOD_RULE.fired, 1);
  assert.equal(out.perRule.GOOD_RULE.sampleSize, 'low');
  /* Low-sample rule must NOT appear in any ranking even if its
     delta is huge — protects against single-fire flukes. */
  assert.ok(!out.topPositiveDelta.includes('GOOD_RULE'));
  assert.ok(!out.topNegativeDelta.includes('GOOD_RULE'));
  assert.ok(!out.suspiciousRules.includes('GOOD_RULE'));
});

test('opts.minSamples is honored', () => {
  /* Same history; minSamples=1 promotes everything to "sufficient" */
  const hist = [
    makeEntry({ tags: ['🟢GOOD'], pctChange: 10 }),
    makeEntry({ tags: ['🟡NEU'], pctChange: 1 }),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW, minSamples: 1 });
  assert.equal(out.perRule.GOOD_RULE.sampleSize, 'sufficient');
});

/* ─── Per-tier breakdown ─────────────────────────────────────── */

test('byTier breakdown isolates ULTRA vs STRONG correctly', () => {
  const hist = [
    /* ULTRA tier, GOOD fires, wins big */
    makeEntry({ tier: 'ULTRA', tags: ['🟢GOOD'], pctChange: 10 }),
    makeEntry({ tier: 'ULTRA', tags: ['🟢GOOD'], pctChange: 8 }),
    /* STRONG tier, GOOD absent, neutral */
    makeEntry({ tier: 'STRONG', tags: ['🟡NEU'], pctChange: 2, outcome: 'partial_win' }),
    makeEntry({ tier: 'STRONG', tags: ['🟡NEU'], pctChange: -1, outcome: 'partial_loss' }),
  ];
  const out = computeRuleAttribution(hist, RULES, { now: NOW, minSamples: 1 });
  assert.equal(out.byTier.ULTRA.totalEvaluated, 2);
  assert.equal(out.byTier.STRONG.totalEvaluated, 2);
  assert.equal(out.byTier.ULTRA.perRule.GOOD_RULE.fired, 2);
  assert.equal(out.byTier.STRONG.perRule.GOOD_RULE.fired, 0);
});

/* ─── computeBacktestSummary integration ─────────────────────── */

test('summary bundles attribution + basket stats', () => {
  const hist = [
    makeEntry({ tags: ['🟢GOOD'], pctChange: 6, outcome: 'win' }),
    makeEntry({ tags: ['🔴BAD'], pctChange: -5, outcome: 'loss' }),
    makeEntry({ tags: [], pctChange: 0, outcome: 'partial_win' }),
  ];
  const out = computeBacktestSummary(hist, RULES, { now: NOW, minSamples: 1 });
  assert.equal(out.basket.total, 3);
  assert.equal(out.basket.wins, 1);
  assert.equal(out.basket.losses, 1);
  assert.equal(out.basket.partials, 1);
  assert.equal(out.basket.winRate, 33); /* 1 / 3 = 33% */
  /* And the attribution map should still be present */
  assert.ok('perRule' in out);
  assert.ok('GOOD_RULE' in out.perRule);
});

test('windowDays defaults to 30 and is configurable', () => {
  assert.equal(DEFAULT_DAYS_BACK, 30);
  assert.equal(MIN_DEFAULT_SAMPLES, 5);
  const out = computeRuleAttribution([], RULES, { now: NOW });
  assert.equal(out.windowDays, 30);
  const out7 = computeRuleAttribution([], RULES, { now: NOW, daysBack: 7 });
  assert.equal(out7.windowDays, 7);
});

test('invalid daysBack falls back to default', () => {
  const out = computeRuleAttribution([], RULES, { now: NOW, daysBack: -1 });
  assert.equal(out.windowDays, DEFAULT_DAYS_BACK);
  const out2 = computeRuleAttribution([], RULES, { now: NOW, daysBack: 'abc' });
  assert.equal(out2.windowDays, DEFAULT_DAYS_BACK);
});
