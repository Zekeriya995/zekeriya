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
  compareWeightProfiles,
  MIN_DEFAULT_SAMPLES,
  DEFAULT_DAYS_BACK,
} = require('../src/scanner-backtest');
const scoringRules = require('../src/scoring-rules');

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

/* ─── Phase 4 Part 3 — hybrid attribution (ctx-based when present) */

/* Rules with REAL conditions for the ctx-replay tests. */
const RULES_WITH_CONDITIONS = Object.freeze([
  Object.freeze({
    id: 'BIG_VOL',
    weight: 25,
    tag: '🔥BIG',
    condition: (ctx) => ctx && ctx.volume > 1e8,
  }),
  Object.freeze({
    id: 'TAGLESS_PENALTY',
    weight: -15,
    tag: null /* tagless — can only be attributed via ctx replay */,
    condition: (ctx) => ctx && ctx.change > 5,
  }),
]);

test('Part 3 — ctx-based attribution catches a TAGLESS rule', () => {
  /* Pre-Part-3, tagless rules were skipped entirely. Now an entry
     with ctx allows the harness to replay the condition and
     attribute the rule. */
  const hist = [
    /* 5 entries where TAGLESS_PENALTY's condition fires (change > 5)
       and all 5 lose */
    ...Array(5)
      .fill(0)
      .map(() =>
        makeEntry({
          tags: [],
          pctChange: -4,
          outcome: 'loss',
        })
      )
      .map((e, i) => ({ ...e, ctx: { volume: 1e7, change: 7 + i } })),
    /* 5 entries where condition does NOT fire (change <= 5) and
       all 5 win */
    ...Array(5)
      .fill(0)
      .map(() =>
        makeEntry({
          tags: [],
          pctChange: 6,
          outcome: 'win',
        })
      )
      .map((e) => ({ ...e, ctx: { volume: 1e7, change: 1 } })),
  ];
  const out = computeRuleAttribution(hist, RULES_WITH_CONDITIONS, { now: NOW });
  /* TAGLESS_PENALTY MUST appear in perRule now (was skipped pre-Part-3). */
  assert.ok('TAGLESS_PENALTY' in out.perRule, 'tagless rule must be attributable via ctx');
  const tp = out.perRule.TAGLESS_PENALTY;
  assert.equal(tp.fired, 5);
  assert.equal(tp.absent, 5);
  assert.equal(tp.firedAvgGain, -4);
  assert.equal(tp.absentAvgGain, 6);
  assert.equal(tp.delta, -10);
  assert.equal(tp.attributableEntries, 10);
  assert.equal(tp.tag, null);
});

test('Part 3 — tagged rule with ctx uses condition (same answer as tag)', () => {
  /* For a TAGGED rule, both paths produce identical results
     because the same condition produced the tag at signal time.
     This test verifies the hybrid switch doesn't break tagged
     attribution. */
  const hist = [
    /* 3 entries where BIG_VOL fires (volume > 1e8) — note: NO
       tag in entry.tags, but the ctx has volume > 1e8. Pre-Part-3
       would not attribute these to BIG_VOL. Post-Part-3, the ctx
       replay attributes them correctly. */
    ...Array(3)
      .fill(0)
      .map(() => makeEntry({ tags: [], pctChange: 8, outcome: 'win' }))
      .map((e) => ({ ...e, ctx: { volume: 5e8, change: 1 } })),
    /* 3 entries where BIG_VOL doesn't fire */
    ...Array(3)
      .fill(0)
      .map(() => makeEntry({ tags: [], pctChange: -2, outcome: 'partial_loss' }))
      .map((e) => ({ ...e, ctx: { volume: 1e6, change: 1 } })),
  ];
  const out = computeRuleAttribution(hist, RULES_WITH_CONDITIONS, { now: NOW, minSamples: 3 });
  const bv = out.perRule.BIG_VOL;
  assert.equal(bv.fired, 3);
  assert.equal(bv.absent, 3);
  assert.equal(bv.firedAvgGain, 8);
  assert.equal(bv.absentAvgGain, -2);
});

test('Part 3 — backwards compat: entries WITHOUT ctx fall back to tag attribution', () => {
  /* Mix old entries (no ctx) and new entries (with ctx). The
     hybrid should use ctx where available, tags elsewhere. */
  const hist = [
    /* Old entry with tag, no ctx — uses tag */
    makeEntry({ tags: ['🔥BIG'], pctChange: 10, outcome: 'win' }),
    makeEntry({ tags: ['🔥BIG'], pctChange: 10, outcome: 'win' }),
    /* New entry with ctx, no tag — uses condition */
    {
      ...makeEntry({ tags: [], pctChange: 12, outcome: 'win' }),
      ctx: { volume: 5e8, change: 1 } /* condition fires */,
    },
    /* New entry with ctx, condition doesn't fire */
    {
      ...makeEntry({ tags: [], pctChange: -3, outcome: 'partial_loss' }),
      ctx: { volume: 1e6, change: 1 } /* condition doesn't fire */,
    },
  ];
  const out = computeRuleAttribution(hist, RULES_WITH_CONDITIONS, { now: NOW, minSamples: 1 });
  const bv = out.perRule.BIG_VOL;
  /* 3 total fired (2 via tag, 1 via ctx); 1 absent (via ctx) */
  assert.equal(bv.fired, 3);
  assert.equal(bv.absent, 1);
});

test('Part 3 — rule whose condition throws is skipped per-entry (no crash)', () => {
  /* Defensive: a buggy rule should not crash the backtest. */
  const buggyRules = [
    Object.freeze({
      id: 'BUGGY',
      weight: 10,
      tag: '💣BUGGY',
      condition: () => {
        throw new Error('rule crash!');
      },
    }),
  ];
  const hist = [
    { ...makeEntry({ tags: ['💣BUGGY'], pctChange: 5 }), ctx: { volume: 1e7 } },
    { ...makeEntry({ tags: [], pctChange: 5 }), ctx: { volume: 1e7 } },
  ];
  /* Should NOT throw. */
  let out;
  assert.doesNotThrow(() => {
    out = computeRuleAttribution(hist, buggyRules, { now: NOW, minSamples: 1 });
  });
  /* With ctx present and condition crashing, neither entry can
     be attributed via ctx → both fall through to skip. With no
     attributable entries the rule is omitted from perRule. */
  assert.ok(!('BUGGY' in out.perRule));
});

test('Part 3 — tagless rule with no ctx anywhere is still skipped', () => {
  /* If a tagless rule cannot be attributed against ANY evaluated
     entry, it must be omitted from perRule (no noise). */
  const hist = [
    /* Old entries — no ctx, and the rule has no tag, so unattributable */
    makeEntry({ tags: ['🔥BIG'], pctChange: 5 }),
    makeEntry({ tags: ['🔥BIG'], pctChange: 5 }),
  ];
  const out = computeRuleAttribution(hist, RULES_WITH_CONDITIONS, { now: NOW, minSamples: 1 });
  assert.ok(!('TAGLESS_PENALTY' in out.perRule), 'unattributable tagless rule must be omitted');
});

/* ─── compareWeightProfiles — champion/challenger A/B ──────────── */

/* Deterministic fake: the registry scoreDelta is whatever the entry's ctx
   carries for the chosen profile, so tests control champion/challenger
   scores exactly without depending on real rule conditions. */
function fakeApply(ctx, opts) {
  const v2 = !!(opts && opts.weightsV2);
  return { scoreDelta: v2 ? ctx._v2 || 0 : ctx._legacy || 0, tagsDelta: [] };
}
const TH = { STRONG: 70 };

function abEntry(over) {
  return Object.assign(
    {
      s: 'X',
      evaluated: true,
      outcome: 'win',
      recordedAt: NOW,
      pctChange: 0,
      score: 75,
      weightsProfile: 'legacy',
      ctx: { _legacy: 0, _v2: 0 },
    },
    over
  );
}

test('compareWeightProfiles — keeps winners, drops losers (net of fees)', () => {
  const hist = [
    /* legacy-surfaced loser that V2 de-ranks below STRONG (75→45) */
    abEntry({ score: 75, ctx: { _legacy: 30, _v2: 0 }, pctChange: -5, outcome: 'loss' }),
    /* winner V2 keeps (80→95) */
    abEntry({ score: 80, ctx: { _legacy: 10, _v2: 25 }, pctChange: 8 }),
    /* neutral both keep (72→72) */
    abEntry({ score: 72, ctx: { _legacy: 5, _v2: 5 }, pctChange: 1 }),
  ];
  const out = compareWeightProfiles(hist, fakeApply, TH, { now: NOW });
  assert.equal(out.feePct, 0.2);
  assert.equal(out.champion.surfaced, 3);
  assert.equal(out.champion.netWinRate, 67); // 2/3 net-positive
  assert.equal(out.champion.avgNetGain, 1.13); // (-5.2 + 7.8 + 0.8)/3
  assert.equal(out.challenger.surfaced, 2);
  assert.equal(out.challenger.netWinRate, 100);
  assert.equal(out.challenger.avgNetGain, 4.3); // (7.8 + 0.8)/2
  assert.equal(out.dropped.count, 1);
  assert.equal(out.dropped.avgNetGain, -5.2);
  /* The whole point: challenger beats champion AND the dropped set is the worst. */
  assert.ok(out.challenger.avgNetGain > out.champion.avgNetGain);
  assert.ok(out.dropped.avgNetGain < out.challenger.avgNetGain);
});

test('compareWeightProfiles — recovers base score when V2 was the live profile', () => {
  /* entry.score was produced under V2 (weightsProfile:v2), so the live delta
     is the V2 delta — base must still come out right. */
  const hist = [
    abEntry({
      weightsProfile: 'v2',
      score: 60,
      ctx: { _legacy: 25, _v2: 5 },
      pctChange: 2,
    }),
  ];
  const out = compareWeightProfiles(hist, fakeApply, TH, { now: NOW });
  // base = 60 - 5 = 55 → champion 55+25=80 (surfaced), challenger 55+5=60 (dropped)
  assert.equal(out.champion.surfaced, 1);
  assert.equal(out.challenger.surfaced, 0);
  assert.equal(out.dropped.count, 1);
});

test('compareWeightProfiles — feePct is configurable and applied to gains', () => {
  const hist = [abEntry({ score: 72, ctx: { _legacy: 5, _v2: 5 }, pctChange: 1 })];
  const zero = compareWeightProfiles(hist, fakeApply, TH, { now: NOW, feePct: 0 });
  assert.equal(zero.champion.avgNetGain, 1); // no fee deducted
  const high = compareWeightProfiles(hist, fakeApply, TH, { now: NOW, feePct: 1 });
  assert.equal(high.champion.avgNetGain, 0); // 1 - 1
});

test('compareWeightProfiles — entries outside the window are excluded', () => {
  const hist = [
    abEntry({ score: 75, ctx: { _legacy: 10, _v2: 10 }, recordedAt: NOW - 40 * 86400000 }),
  ];
  const out = compareWeightProfiles(hist, fakeApply, TH, { now: NOW, daysBack: 30 });
  assert.equal(out.champion.surfaced, 0);
  assert.equal(out.sampleSize, 'low');
});

test('compareWeightProfiles — a throwing applyRules skips the entry, never crashes', () => {
  const boom = () => {
    throw new Error('bad ctx');
  };
  const hist = [abEntry({ score: 80, ctx: { _legacy: 10, _v2: 10 }, pctChange: 5 })];
  let out;
  assert.doesNotThrow(() => {
    out = compareWeightProfiles(hist, boom, TH, { now: NOW });
  });
  assert.equal(out.champion.surfaced, 0);
});

test('compareWeightProfiles — integration: real rules drop a Top-100-only signal', () => {
  /* ctx fires TIER1_BONUS only (legacy +10 / V2 0). base = 75-10 = 65, so the
     champion surfaces it (75) while V2 drops it (65 < 70) — the measured
     Top-100 de-ranking, end-to-end through the real registry. */
  const hist = [
    abEntry({
      score: 75,
      pctChange: -3,
      outcome: 'loss',
      ctx: { isTier1: true, volume: 1, change: 0 },
    }),
  ];
  const out = compareWeightProfiles(hist, scoringRules.applyRules, scoringRules.THRESHOLDS, {
    now: NOW,
  });
  assert.equal(out.champion.surfaced, 1);
  assert.equal(out.challenger.surfaced, 0);
  assert.equal(out.dropped.count, 1);
});
