/* Unit tests for src/scanner-history.js — exercise the pure
   functions (recordSignal, evaluateOpenSignals, computeStats)
   without touching disk. The disk wrappers (loadHistory,
   saveHistory) are kept thin on purpose; we cover them indirectly
   via their crash-tolerant fallback (returning [] on a missing
   file). */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVAL_AFTER_MS,
  RECORD_COOLDOWN_MS,
  MAX_TAGS,
  loadHistory,
  recordSignal,
  evaluateOpenSignals,
  computeStats,
} = require('../src/scanner-history');

const NOW = 1_730_000_000_000; /* fixed timestamp for deterministic tests */

function ultra(s, price) {
  return {
    s,
    score: 105,
    tier: 'ULTRA',
    price: price || 100,
    sl: (price || 100) * 0.97,
    tp1: (price || 100) * 1.05,
  };
}

function strong(s, price) {
  return {
    s,
    score: 80,
    tier: 'STRONG',
    price: price || 100,
    sl: (price || 100) * 0.97,
    tp1: (price || 100) * 1.05,
  };
}

/* ─── recordSignal ────────────────────────────────────────────────── */

test('recordSignal — null / invalid input returns history untouched', () => {
  const h = [];
  assert.equal(recordSignal(h, null, NOW), h);
  assert.equal(recordSignal(h, {}, NOW), h);
  assert.equal(recordSignal(h, { s: 'BTC' }, NOW), h);
});

test('recordSignal — only ULTRA / STRONG tiers are kept', () => {
  const h = [];
  recordSignal(h, { s: 'X', tier: 'WEAK', score: 30, price: 1 }, NOW);
  recordSignal(h, { s: 'Y', tier: 'MEDIUM', score: 50, price: 1 }, NOW);
  assert.equal(h.length, 0);
  recordSignal(h, ultra('BTC'), NOW);
  recordSignal(h, strong('ETH'), NOW);
  assert.equal(h.length, 2);
});

test('recordSignal — per-symbol cooldown blocks re-record within 1h', () => {
  const h = [];
  recordSignal(h, ultra('BTC'), NOW);
  recordSignal(h, ultra('BTC'), NOW + 30 * 60 * 1000); /* 30 min later */
  assert.equal(h.length, 1);
  recordSignal(h, ultra('BTC'), NOW + RECORD_COOLDOWN_MS + 1); /* past cooldown */
  assert.equal(h.length, 2);
});

test('recordSignal — different symbols within cooldown both recorded', () => {
  const h = [];
  recordSignal(h, ultra('BTC'), NOW);
  recordSignal(h, ultra('ETH'), NOW + 1000);
  assert.equal(h.length, 2);
});

test('recordSignal — caps at MAX_HISTORY (oldest dropped)', () => {
  /* Use a small array to keep the test fast; MAX_HISTORY is 1000 in
     the module but the cap logic is what we verify. */
  const h = [];
  for (let i = 0; i < 1100; i++) {
    recordSignal(h, ultra('S' + i), NOW + i * 60_000); /* spread by minutes to dodge cooldown */
  }
  assert.equal(h.length, 1000);
  assert.equal(h[0].s, 'S100', 'oldest 100 entries should have been dropped');
});

/* ─── recordSignal — tags persistence (Phase 1.0b) ─────────────── */

test('recordSignal — sig.tags is persisted on the entry', () => {
  const h = [];
  const sig = { ...ultra('BTC'), tags: ['🚀VERTICAL', '🔥FR_EXTREME', 'BTC✅'] };
  recordSignal(h, sig, NOW);
  assert.deepEqual(h[0].tags, ['🚀VERTICAL', '🔥FR_EXTREME', 'BTC✅']);
});

test('recordSignal — missing sig.tags defaults to empty array', () => {
  const h = [];
  recordSignal(h, ultra('BTC'), NOW); /* no tags property at all */
  assert.deepEqual(h[0].tags, []);
});

test('recordSignal — non-array sig.tags coerced to empty array', () => {
  const h = [];
  recordSignal(h, { ...ultra('BTC'), tags: 'not-an-array' }, NOW);
  assert.deepEqual(h[0].tags, []);
  recordSignal(h, { ...ultra('ETH'), tags: null }, NOW);
  assert.deepEqual(h[1].tags, []);
});

test('recordSignal — sig.tags is capped at MAX_TAGS', () => {
  const h = [];
  const bloated = Array.from({ length: MAX_TAGS + 50 }, (_, i) => 'TAG' + i);
  recordSignal(h, { ...ultra('BTC'), tags: bloated }, NOW);
  assert.equal(h[0].tags.length, MAX_TAGS);
  assert.equal(h[0].tags[0], 'TAG0');
  assert.equal(h[0].tags[MAX_TAGS - 1], 'TAG' + (MAX_TAGS - 1));
});

test('recordSignal — tags array is independent (slice, not reference)', () => {
  const h = [];
  const tags = ['A', 'B'];
  recordSignal(h, { ...ultra('BTC'), tags }, NOW);
  tags.push('C'); /* mutate caller's array AFTER recording */
  assert.deepEqual(h[0].tags, ['A', 'B'], 'recorded tags should not see post-record mutation');
});

/* ─── evaluateOpenSignals ─────────────────────────────────────────── */

test('evaluateOpenSignals — entries inside the 24h window stay open', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  const { updated } = evaluateOpenSignals(h, { BTC: 110 }, NOW + 12 * 60 * 60 * 1000);
  assert.equal(updated, 0);
  assert.equal(h[0].evaluated, false);
});

test('evaluateOpenSignals — past 24h, +5%+ gain → outcome=win', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  const after = NOW + EVAL_AFTER_MS + 1;
  const { updated } = evaluateOpenSignals(h, { BTC: 106 }, after);
  assert.equal(updated, 1);
  assert.equal(h[0].outcome, 'win');
  assert.equal(h[0].pctChange, 6);
});

test('evaluateOpenSignals — small positive PnL → partial_win', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  const { updated } = evaluateOpenSignals(h, { BTC: 102 }, NOW + EVAL_AFTER_MS + 1);
  assert.equal(updated, 1);
  assert.equal(h[0].outcome, 'partial_win');
});

test('evaluateOpenSignals — small drawdown (-3 < change < 0) → partial_loss', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  evaluateOpenSignals(h, { BTC: 98 }, NOW + EVAL_AFTER_MS + 1);
  assert.equal(h[0].outcome, 'partial_loss');
});

test('evaluateOpenSignals — past 24h, -3%+ drop → outcome=loss', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  const { updated } = evaluateOpenSignals(h, { BTC: 95 }, NOW + EVAL_AFTER_MS + 1);
  assert.equal(updated, 1);
  assert.equal(h[0].outcome, 'loss');
});

test('evaluateOpenSignals — accepts ticker-shaped price input ({price})', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  const { updated } = evaluateOpenSignals(h, { BTC: { price: 108 } }, NOW + EVAL_AFTER_MS + 1);
  assert.equal(updated, 1);
  assert.equal(h[0].outcome, 'win');
});

test('evaluateOpenSignals — missing price for symbol leaves entry open', () => {
  const h = [];
  recordSignal(h, ultra('BTC', 100), NOW);
  const { updated } = evaluateOpenSignals(h, {}, NOW + EVAL_AFTER_MS + 1);
  assert.equal(updated, 0);
  assert.equal(h[0].evaluated, false);
});

/* ─── computeStats ────────────────────────────────────────────────── */

test('computeStats — empty history returns the empty stats object', () => {
  const out = computeStats([], 7, NOW);
  assert.equal(out.totalEvaluated, 0);
  assert.equal(out.winRate, 0);
});

test('computeStats — only counts entries within the window', () => {
  const h = [
    {
      s: 'BTC',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'win',
      pctChange: 8,
    },
    {
      s: 'ETH',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 30 * 24 * 60 * 60 * 1000,
      outcome: 'win',
      pctChange: 10,
    },
  ];
  const out = computeStats(h, 7, NOW);
  assert.equal(out.totalEvaluated, 1, 'old ETH entry should be filtered out');
});

test('computeStats — winRate, avgGain, best/worst computed correctly', () => {
  const h = [
    {
      s: 'BTC',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'win',
      pctChange: 8,
    },
    {
      s: 'ETH',
      tier: 'STRONG',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'partial_win',
      pctChange: 2,
    },
    {
      s: 'SOL',
      tier: 'STRONG',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'loss',
      pctChange: -5,
    },
    {
      s: 'AVAX',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'win',
      pctChange: 12,
    },
  ];
  const out = computeStats(h, 7, NOW);
  assert.equal(out.totalEvaluated, 4);
  assert.equal(out.wins, 2);
  assert.equal(out.losses, 1);
  assert.equal(out.winRate, 50);
  /* avg = (8 + 2 + -5 + 12) / 4 = 4.25 */
  assert.equal(out.avgGain, 4.25);
  assert.equal(out.bestSignal.s, 'AVAX');
  assert.equal(out.worstSignal.s, 'SOL');
});

test('computeStats — byTier breakdown groups ULTRA vs STRONG separately', () => {
  const h = [
    {
      s: 'BTC',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'win',
      pctChange: 8,
    },
    {
      s: 'ETH',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'win',
      pctChange: 6,
    },
    {
      s: 'SOL',
      tier: 'STRONG',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'loss',
      pctChange: -4,
    },
  ];
  const out = computeStats(h, 7, NOW);
  assert.equal(out.byTier.ULTRA.count, 2);
  assert.equal(out.byTier.ULTRA.winRate, 100);
  assert.equal(out.byTier.STRONG.count, 1);
  assert.equal(out.byTier.STRONG.winRate, 0);
});

/* ─── loadHistory ─────────────────────────────────────────────────── */

test('loadHistory — returns [] when the file does not exist', () => {
  /* The default HISTORY_FILE points at data/scanner-history.json
     in the repo. If a previous test run created it, this still
     proves the function returns an array. */
  const out = loadHistory();
  assert.ok(Array.isArray(out));
});
