/* Unit tests for src/scanner-engine.js — the always-on server-side
   pass that mirrors the PWA's quickScan and feeds /api/all's signals
   plus the ULTRA + Top-3 push triggers. Covers the score-out paths
   that matter for the trigger thresholds (ULTRA cutoff, Top 3
   ordering, hard rejects) without re-testing every individual tag
   the helpers fire. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { runScannerPass, scoreSymbol, STABLE_SET, TIER1_SYMBOLS } = require('../src/scanner-engine');

function tk(over) {
  return Object.assign({ price: 100, change: 1, volume: 1e8, high: 102, low: 98 }, over);
}

test('STABLE_SET excludes obvious stablecoins', () => {
  for (const s of ['USDT', 'USDC', 'DAI', 'TUSD', 'BUSD', 'FDUSD', 'USDP', 'PYUSD']) {
    assert.equal(STABLE_SET.has(s), true, s + ' should be a stablecoin');
  }
  assert.equal(STABLE_SET.has('BTC'), false);
});

test('TIER1_SYMBOLS contains the majors', () => {
  for (const s of ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']) {
    assert.equal(TIER1_SYMBOLS.has(s), true, s + ' should be tier 1');
  }
});

/* ─── scoreSymbol ─────────────────────────────────────────────────── */

test('scoreSymbol — null when no ticker data', () => {
  assert.equal(scoreSymbol('FOO', { ticker: null }), null);
});

test('scoreSymbol — null when overheated (>= 8% change)', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ change: 9 }) });
  assert.equal(r, null);
});

test('scoreSymbol — null when volume below tier-1 floor', () => {
  /* BTC is tier 1 → minVol = 1M. 500K is below. */
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 500_000 }) });
  assert.equal(r, null);
});

test('scoreSymbol — tier-1 majors get the TOP100 bonus tag', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  assert.ok(r);
  assert.ok(r.tags.includes('🏆TOP100'));
});

test('scoreSymbol — silent accumulation tag fires on flat+volume', () => {
  const r = scoreSymbol('BTC', { ticker: tk({ volume: 6e7, change: 0.5 }) });
  assert.ok(r.tags.includes('🐋ACC'));
});

test('scoreSymbol — late entry penalty (change > 5)', () => {
  const flat = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const late = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 6 }) });
  assert.ok(flat && late);
  assert.ok(flat.score > late.score, 'late entries must score lower than flat ones');
});

test('scoreSymbol — funding-rate negative adds points', () => {
  const noFr = scoreSymbol('BTC', { ticker: tk({ volume: 5e7, change: 0.5 }) });
  const withFr = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    fr: { rate: -0.02 },
  });
  assert.ok(withFr.score > noFr.score);
  assert.ok(withFr.tags.includes('FR⬇️'));
});

test('scoreSymbol — coinalyze multi-exchange FR negative confirms', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    coinalyzeFR: { rate: -0.02 },
  });
  assert.ok(r.tags.includes('🌐FR_NEG'));
});

test('scoreSymbol — bitfinex margin long >= 65 confirms', () => {
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 5e7, change: 0.5 }),
    bitfinex: { longPct: 75 },
  });
  assert.ok(r.tags.includes('📊BFX_LONG'));
});

test('scoreSymbol — tier label crosses the ULTRA threshold', () => {
  /* Stack enough positive signals to clear 100. */
  const r = scoreSymbol('BTC', {
    ticker: tk({ volume: 1.2e9, change: 0.5, high: 100.5, low: 95 }),
    fr: { rate: -0.02 },
    ls: { ratio: 0.5 },
    taker: { ratio: 2, avg: 1 },
    coinalyzeFR: { rate: -0.02 },
    hyperliquid: { funding: -0.001 },
    bitfinex: { longPct: 75 },
  });
  assert.ok(r);
  assert.ok(r.score >= 100, 'expected ULTRA score, got ' + r.score);
  assert.equal(r.tier, 'ULTRA');
});

/* ─── runScannerPass ──────────────────────────────────────────────── */

test('runScannerPass — empty cache yields empty signals', () => {
  const out = runScannerPass({ tickers: {} });
  assert.deepEqual(out.signals, []);
  assert.deepEqual(out.top3, []);
  assert.ok(typeof out.ts === 'number');
});

test('runScannerPass — stablecoins are filtered out', () => {
  const cache = {
    tickers: {
      USDT: tk({ volume: 5e7, change: 0.5 }),
      USDC: tk({ volume: 5e7, change: 0.5 }),
      BTC: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.signals.length, 1);
  assert.equal(out.signals[0].s, 'BTC');
});

test('runScannerPass — top3 is ranked by score, length capped at 3', () => {
  const cache = {
    tickers: {
      BTC: tk({ volume: 5e7, change: 0.5 }),
      ETH: tk({ volume: 1.2e9, change: 0.5 }) /* mega vol → highest score */,
      SOL: tk({ volume: 1e8, change: 0.5 }),
      BNB: tk({ volume: 5e7, change: 0.5 }),
      XRP: tk({ volume: 5e7, change: 0.5 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.top3.length, 3);
  /* The mega-volume coin must lead the ranking. */
  assert.equal(out.top3[0].s, 'ETH');
  /* Ranking is descending. */
  for (let i = 1; i < out.top3.length; i++) {
    assert.ok(out.top3[i - 1].score >= out.top3[i].score);
  }
});

test('runScannerPass — drops symbols whose score floor is below the gate', () => {
  /* BTC at 6% gain is past the late-entry penalty cliff and should
     not appear in signals (score < 30 after penalties). */
  const cache = {
    tickers: {
      BTC: tk({ volume: 1e6, change: 6 }),
    },
  };
  const out = runScannerPass(cache);
  assert.equal(out.signals.length, 0);
});

test('runScannerPass — multi-exchange context flows through to scoring', () => {
  const cache = {
    tickers: { BTC: tk({ volume: 5e7, change: 0.5 }) },
    fr: { BTC: { rate: -0.02 } },
    dsMulti: {
      coinalyze: { fr: { BTC: { rate: -0.02 } } },
      hyperliquid: { BTC: { funding: -0.001 } },
      bitfinex: { BTC: { longPct: 75 } },
    },
  };
  const baseline = runScannerPass({ tickers: cache.tickers });
  const enriched = runScannerPass(cache);
  assert.ok(
    enriched.signals[0].score > baseline.signals[0].score,
    'enrichment should raise the score'
  );
});
