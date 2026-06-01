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

test('recordSignal — stamps weightsProfile, passing through v2 and trend verbatim', () => {
  const h = [];
  recordSignal(h, { ...ultra('LEG') }, NOW); /* no profile → legacy */
  recordSignal(h, { ...ultra('VEE'), weightsProfile: 'v2' }, NOW + 60_000);
  recordSignal(h, { ...ultra('TRN'), weightsProfile: 'trend' }, NOW + 120_000);
  recordSignal(h, { ...ultra('JNK'), weightsProfile: 'bogus' }, NOW + 180_000);
  assert.equal(h[0].weightsProfile, 'legacy');
  assert.equal(h[1].weightsProfile, 'v2');
  /* trend is the LIVE profile in a trending regime — it must survive,
     or liveProfilePerformance's forward trend bucket is always empty. */
  assert.equal(h[2].weightsProfile, 'trend');
  assert.equal(h[3].weightsProfile, 'legacy'); /* unknown → legacy */
});

test('recordSignal — stamps marketRegime, allowlisting bull/bear/ranging', () => {
  const h = [];
  recordSignal(h, { ...ultra('NON') }, NOW); /* no field → unknown */
  recordSignal(h, { ...ultra('BER'), marketRegime: 'bear' }, NOW + 60_000);
  recordSignal(h, { ...ultra('BUL'), marketRegime: 'bull' }, NOW + 120_000);
  recordSignal(h, { ...ultra('RNG'), marketRegime: 'ranging' }, NOW + 180_000);
  recordSignal(
    h,
    { ...ultra('JNK'), marketRegime: 'trending' },
    NOW + 240_000
  ); /* not allowlisted */
  assert.equal(h[0].marketRegime, 'unknown'); /* absent → unknown */
  assert.equal(h[1].marketRegime, 'bear'); /* the case that must survive for
                                              per-regime L2 calibration */
  assert.equal(h[2].marketRegime, 'bull');
  assert.equal(h[3].marketRegime, 'ranging');
  assert.equal(h[4].marketRegime, 'unknown'); /* arbitrary string sanitized */
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

/* ─── Phase 3.3 — Alpha-based win rate ────────────────────────── */

function evalEntry(over) {
  return Object.assign(
    {
      s: 'BTC',
      tier: 'ULTRA',
      evaluated: true,
      recordedAt: NOW - 1000,
      outcome: 'partial_win',
      pctChange: 0,
    },
    over
  );
}

test('computeStats.alpha — suppressed when fewer than 3 evaluated entries', () => {
  const h = [
    evalEntry({ pctChange: 5, outcome: 'win' }),
    evalEntry({ s: 'ETH', pctChange: 8, outcome: 'win' }),
  ];
  const out = computeStats(h, 7, NOW);
  assert.equal(out.alpha, null, 'alpha block must be null with < 3 samples');
});

test('computeStats.alpha — exposed with 3+ evaluated entries', () => {
  const h = [
    evalEntry({ s: 'A', pctChange: 5, outcome: 'win' }),
    evalEntry({ s: 'B', pctChange: 2, outcome: 'partial_win' }),
    evalEntry({ s: 'C', pctChange: -3, outcome: 'loss' }),
  ];
  const out = computeStats(h, 7, NOW);
  assert.ok(out.alpha);
  assert.equal(typeof out.alpha.basketMedian, 'number');
  assert.equal(typeof out.alpha.avgAlpha, 'number');
  assert.equal(typeof out.alpha.alphaWinRate, 'number');
});

test('computeStats.alpha — basketMedian is the median of all pctChange values', () => {
  const h = [
    evalEntry({ s: 'A', pctChange: 10, outcome: 'win' }),
    evalEntry({ s: 'B', pctChange: 4, outcome: 'win' }) /* median */,
    evalEntry({ s: 'C', pctChange: -2, outcome: 'loss' }),
  ];
  const out = computeStats(h, 7, NOW);
  assert.equal(out.alpha.basketMedian, 4);
});

test('computeStats.alpha — even-length basket averages the two middle values', () => {
  const h = [
    evalEntry({ s: 'A', pctChange: 10, outcome: 'win' }),
    evalEntry({ s: 'B', pctChange: 6, outcome: 'win' }),
    evalEntry({ s: 'C', pctChange: 2, outcome: 'partial_win' }),
    evalEntry({ s: 'D', pctChange: -2, outcome: 'loss' }),
  ];
  const out = computeStats(h, 7, NOW);
  /* Sorted: [-2, 2, 6, 10] → mid pair (2, 6) → median = 4 */
  assert.equal(out.alpha.basketMedian, 4);
});

test('computeStats.alpha — avgAlpha is mean(pctChange - basketMedian)', () => {
  const h = [
    evalEntry({ s: 'A', pctChange: 10, outcome: 'win' }),
    evalEntry({ s: 'B', pctChange: 4, outcome: 'win' }),
    evalEntry({ s: 'C', pctChange: -2, outcome: 'loss' }),
  ];
  const out = computeStats(h, 7, NOW);
  /* median = 4. alphas = [6, 0, -6]. mean = 0. */
  assert.equal(out.alpha.avgAlpha, 0);
});

test('computeStats.alpha — alphaWinRate counts signals with alpha > 0', () => {
  const h = [
    evalEntry({ s: 'A', pctChange: 10, outcome: 'win' }) /* alpha = +6 > 0 */,
    evalEntry({ s: 'B', pctChange: 4, outcome: 'win' }) /* alpha = 0, NOT > 0 */,
    evalEntry({ s: 'C', pctChange: -2, outcome: 'loss' }) /* alpha = -6 < 0 */,
  ];
  const out = computeStats(h, 7, NOW);
  /* 1 of 3 has alpha > 0 → 33% */
  assert.equal(out.alpha.alphaWinRate, 33);
});

test('computeStats.alpha — bestAlpha and worstAlpha identify the extremes', () => {
  const h = [
    evalEntry({ s: 'BIG', pctChange: 20, outcome: 'win' }),
    evalEntry({ s: 'MID', pctChange: 5, outcome: 'win' }),
    evalEntry({ s: 'SMALL', pctChange: -10, outcome: 'loss' }),
  ];
  const out = computeStats(h, 7, NOW);
  assert.equal(out.alpha.bestAlpha.s, 'BIG');
  assert.equal(out.alpha.worstAlpha.s, 'SMALL');
  /* median = 5. alphas: BIG=+15, MID=0, SMALL=-15 */
  assert.equal(out.alpha.bestAlpha.alpha, 15);
  assert.equal(out.alpha.worstAlpha.alpha, -15);
});

test('computeStats.alpha — works on a heavily-skewed distribution', () => {
  /* 10 mediocre signals + 1 huge winner → median dragged toward low end,
     alpha for the outlier is large. */
  const h = [];
  for (let i = 0; i < 10; i++) {
    h.push(evalEntry({ s: 'BORING' + i, pctChange: 1, outcome: 'partial_win' }));
  }
  h.push(evalEntry({ s: 'MOON', pctChange: 50, outcome: 'win' }));
  const out = computeStats(h, 7, NOW);
  assert.equal(out.alpha.basketMedian, 1, 'median dominated by the 10 boring entries');
  /* MOON's alpha = 50 - 1 = 49 */
  assert.equal(out.alpha.bestAlpha.s, 'MOON');
  assert.equal(out.alpha.bestAlpha.alpha, 49);
});

test('computeStats.alpha — empty history still returns alpha:null', () => {
  const out = computeStats([], 7, NOW);
  assert.equal(out.alpha, null);
});

/* ─── Phase 4 Part 2 — ctx capture ───────────────────────────── */

const { _sanitizeCtx, CTX_ALLOWLIST_KEYS } = require('../src/scanner-history');

test('_sanitizeCtx — null / non-object input returns null', () => {
  assert.equal(_sanitizeCtx(null), null);
  assert.equal(_sanitizeCtx(undefined), null);
  assert.equal(_sanitizeCtx('a string'), null);
  assert.equal(_sanitizeCtx(42), null);
});

test('_sanitizeCtx — allowlisted scalar fields are kept', () => {
  const raw = {
    isTier1: true,
    isTier2: false,
    volume: 1e8,
    change: 1.5,
    frRate: -0.05,
    mtfStrength: 'full',
    mtfBias: 'bullish',
    cvdTrend: 'BUYING',
    btcMarketOk: true,
  };
  const out = _sanitizeCtx(raw);
  assert.equal(out.isTier1, true);
  assert.equal(out.isTier2, false);
  assert.equal(out.volume, 1e8);
  assert.equal(out.change, 1.5);
  assert.equal(out.frRate, -0.05);
  assert.equal(out.mtfStrength, 'full');
  assert.equal(out.mtfBias, 'bullish');
  assert.equal(out.cvdTrend, 'BUYING');
  assert.equal(out.btcMarketOk, true);
});

test('_sanitizeCtx — unknown keys are SILENTLY DROPPED (allowlist)', () => {
  const raw = {
    isTier1: true,
    secretApiKey: 'should-not-persist',
    nestedJunk: { foo: 'bar' },
    someArray: [1, 2, 3],
  };
  const out = _sanitizeCtx(raw);
  assert.equal(out.isTier1, true);
  assert.equal(out.secretApiKey, undefined, 'unknown key must NOT persist');
  assert.equal(out.nestedJunk, undefined);
  assert.equal(out.someArray, undefined);
});

test('_sanitizeCtx — non-scalar values for known keys are rejected', () => {
  const raw = {
    volume: 'not-a-number',
    change: { value: 1 },
    isTier1: 'truthy-string',
    mtfStrength: ['array'],
  };
  const out = _sanitizeCtx(raw);
  assert.equal(out.volume, undefined);
  assert.equal(out.change, undefined);
  assert.equal(out.isTier1, undefined);
  assert.equal(out.mtfStrength, undefined);
});

test('_sanitizeCtx — non-finite numbers (NaN, Infinity) rejected', () => {
  const raw = { volume: NaN, change: Infinity, frRate: -Infinity };
  const out = _sanitizeCtx(raw);
  assert.equal(out.volume, undefined);
  assert.equal(out.change, undefined);
  assert.equal(out.frRate, undefined);
});

test('_sanitizeCtx — strings > 32 chars rejected', () => {
  const raw = {
    mtfStrength: 'x'.repeat(33),
    mtfBias: 'bullish',
  };
  const out = _sanitizeCtx(raw);
  assert.equal(out.mtfStrength, undefined);
  assert.equal(out.mtfBias, 'bullish');
});

test('CTX_ALLOWLIST_KEYS — covers every ctx field used by the registry', () => {
  /* Locks the contract: any new ctx field added in scoring-rules.js
     MUST also be added to this allowlist if it should persist. */
  assert.ok(CTX_ALLOWLIST_KEYS.includes('isTier1'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('isTier2'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('frRate'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('coinalyzeOIValue'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('mtfStrength'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('macdCross'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('cvdTrend'));
  assert.ok(CTX_ALLOWLIST_KEYS.includes('btcMarketOk'));
});

test('recordSignal — captures sanitized ctx when sig.ctx is present', () => {
  const h = [];
  const sig = {
    s: 'BTC',
    tier: 'ULTRA',
    score: 105,
    price: 100,
    tags: ['🏆TOP100'],
    ctx: {
      isTier1: true,
      volume: 1e8,
      change: 1,
      mtfStrength: 'full',
      mtfBias: 'bullish',
      secretApiKey: 'leak-attempt',
    },
  };
  recordSignal(h, sig, NOW);
  assert.equal(h.length, 1);
  assert.ok(h[0].ctx, 'ctx must be persisted');
  assert.equal(h[0].ctx.isTier1, true);
  assert.equal(h[0].ctx.mtfStrength, 'full');
  assert.equal(h[0].ctx.secretApiKey, undefined, 'allowlist must strip unknown keys');
});

test('recordSignal — omits ctx field when sig.ctx is absent (backwards compat)', () => {
  const h = [];
  const sig = {
    s: 'ETH',
    tier: 'STRONG',
    score: 75,
    price: 2000,
    tags: ['🏆TOP100'],
  };
  recordSignal(h, sig, NOW);
  assert.equal(h.length, 1);
  assert.equal(h[0].ctx, undefined, 'absent ctx must NOT add an empty ctx field');
  assert.equal(h[0].s, 'ETH');
  assert.equal(h[0].tier, 'STRONG');
});
